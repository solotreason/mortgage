import assert from 'node:assert/strict';
import test from 'node:test';
import {
    RATE_EPSILON,
    estimateAnnualMortgageInsuranceRate,
    computeMonthlyPayment,
    computeLoanFromPayment,
    solveRateFromPayment,
    computeMortgageInsuranceForPeriod,
    simulateMortgageSchedule,
    simulateFixedPaymentLoan
} from '../src/core/mortgage-core.js';

const assertApprox = (actual, expected, tolerance = 1e-6) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
};

test('computeMonthlyPayment returns expected principal-and-interest payment', () => {
    const payment = computeMonthlyPayment(350000, 0.065 / 12, 360);
    assertApprox(payment, 2212.2380822253785, 1e-6);
});

test('computeLoanFromPayment inverts computeMonthlyPayment', () => {
    const payment = computeMonthlyPayment(350000, 0.065 / 12, 360);
    const recoveredPrincipal = computeLoanFromPayment(payment, 0.065 / 12, 360);
    assertApprox(recoveredPrincipal, 350000, 1e-6);
});

test('solveRateFromPayment solves nominal monthly rate from financed amount', () => {
    const expectedMonthlyRate = 0.065 / 12;
    const payment = computeMonthlyPayment(330000, expectedMonthlyRate, 360);
    const monthlyRate = solveRateFromPayment(330000, payment, 360);
    assertApprox(monthlyRate, expectedMonthlyRate, 1e-10);
});

test('estimateAnnualMortgageInsuranceRate follows loan-type and LTV policy', () => {
    const vaRate = estimateAnnualMortgageInsuranceRate({ loanType: 'va', homePrice: 400000, downPayment: 0 });
    const fhaRate = estimateAnnualMortgageInsuranceRate({ loanType: 'fha', homePrice: 400000, downPayment: 32000 });
    const convRate = estimateAnnualMortgageInsuranceRate({ loanType: 'conventional', homePrice: 400000, downPayment: 20000 });
    const convTwentyDownRate = estimateAnnualMortgageInsuranceRate({ loanType: 'conventional', homePrice: 400000, downPayment: 80000 });

    assert.equal(vaRate, 0);
    assert.equal(fhaRate, 0.0055);
    assert.equal(convRate, 0.0075);
    assert.equal(convTwentyDownRate, 0);
});

test('computeMortgageInsuranceForPeriod turns off at conventional threshold and FHA 11-year rule', () => {
    const convOn = computeMortgageInsuranceForPeriod({
        loanType: 'conventional',
        balanceBeforePayment: 350000,
        homePrice: 400000,
        annualPmiRate: 0.0075,
        periodIndex: 1,
        periodsPerYear: 12,
        originationLtv: 0.875,
        convPmiDropLtv: 0.80
    });
    const convOff = computeMortgageInsuranceForPeriod({
        loanType: 'conventional',
        balanceBeforePayment: 300000,
        homePrice: 400000,
        annualPmiRate: 0.0075,
        periodIndex: 1,
        periodsPerYear: 12,
        originationLtv: 0.875,
        convPmiDropLtv: 0.80
    });
    const convOffAtOrigination80Ltv = computeMortgageInsuranceForPeriod({
        loanType: 'conventional',
        balanceBeforePayment: 320000,
        homePrice: 400000,
        annualPmiRate: 0.0075,
        periodIndex: 1,
        periodsPerYear: 12,
        originationLtv: 0.80,
        convPmiDropLtv: 0.78
    });
    const fhaOffAfter11Years = computeMortgageInsuranceForPeriod({
        loanType: 'fha',
        balanceBeforePayment: 300000,
        homePrice: 400000,
        annualPmiRate: 0.0055,
        periodIndex: 133,
        periodsPerYear: 12,
        originationLtv: 0.90,
        convPmiDropLtv: 0.80
    });

    assert.ok(convOn > 0);
    assert.equal(convOff, 0);
    assert.equal(convOffAtOrigination80Ltv, 0);
    assert.equal(fhaOffAfter11Years, 0);
});

test('simulateMortgageSchedule produces a full payoff schedule with no PMI when starting below 80% LTV', () => {
    const schedule = simulateMortgageSchedule({
        loanAmount: 300000,
        annualRate: 0.065,
        termMonths: 360,
        frequency: 'monthly',
        extraMonthly: 0,
        extraPaymentYears: 30,
        lumpSumAmount: 0,
        lumpSumMonth: 0,
        recastEnabled: false,
        recastFee: 0,
        homePrice: 400000,
        loanType: 'conventional',
        annualPmiRate: 0.0075,
        convPmiDropLtv: 0.78,
        originationLtv: 0.75
    });

    assert.equal(schedule.periodsElapsed, 360);
    assert.equal(schedule.firstPeriodPmi, 0);
    assert.equal(schedule.totalPmi, 0);
    assert.equal(schedule.yearRows.length, 30);
    assert.ok(schedule.totalInterest > 0);
    assert.ok(schedule.totalPaid > schedule.totalInterest);
    assert.ok(schedule.periodRows[schedule.periodRows.length - 1].balance <= RATE_EPSILON);
});

test('simulateMortgageSchedule with high LTV eventually drops conventional PMI', () => {
    const schedule = simulateMortgageSchedule({
        loanAmount: 330000,
        annualRate: 0.065,
        termMonths: 360,
        frequency: 'monthly',
        extraMonthly: 0,
        extraPaymentYears: 30,
        lumpSumAmount: 0,
        lumpSumMonth: 0,
        recastEnabled: false,
        recastFee: 0,
        homePrice: 350000,
        loanType: 'conventional',
        annualPmiRate: 0.0075,
        convPmiDropLtv: 0.80,
        originationLtv: 330000 / 350000
    });

    assert.ok(schedule.firstPeriodPmi > 0);
    assert.ok(schedule.periodRows.some((row) => row.pmi === 0));
    assert.equal(schedule.periodRows[schedule.periodRows.length - 1].pmi, 0);
});

test('simulateMortgageSchedule applies recast after lump-sum event', () => {
    const schedule = simulateMortgageSchedule({
        loanAmount: 350000,
        annualRate: 0.065,
        termMonths: 360,
        frequency: 'monthly',
        extraMonthly: 0,
        extraPaymentYears: 30,
        lumpSumAmount: 50000,
        lumpSumMonth: 24,
        recastEnabled: true,
        recastFee: 500,
        homePrice: 400000,
        loanType: 'conventional',
        annualPmiRate: 0.0075,
        convPmiDropLtv: 0.80,
        originationLtv: 0.875
    });

    assert.equal(schedule.recastApplied, true);
    assert.equal(schedule.recastPeriod, 24);
    assert.equal(schedule.recastFeeApplied, 500);
    assert.ok(schedule.finalPeriodicPayment < schedule.initialPeriodicPayment);
});

test('simulateFixedPaymentLoan returns Infinity markers for negative amortization payments', () => {
    const impossible = simulateFixedPaymentLoan({
        balance: 350000,
        monthlyRate: 0.065 / 12,
        payment: 500,
        maxMonths: 120
    });

    assert.equal(Number.isFinite(impossible.months), false);
    assert.equal(Number.isFinite(impossible.totalInterest), false);
    assert.equal(Number.isFinite(impossible.totalPaid), false);
    assert.deepEqual(impossible.cumulative, []);
});
