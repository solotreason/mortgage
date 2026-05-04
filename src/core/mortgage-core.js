export const RATE_EPSILON = 1e-10;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const estimateAnnualMortgageInsuranceRate = ({ loanType, homePrice, downPayment }) => {
    const effectiveDown = clamp(downPayment, 0, homePrice);
    const loanAmount = Math.max(0, homePrice - effectiveDown);
    const ltv = homePrice > RATE_EPSILON ? (loanAmount / homePrice) : 1;

    if (loanType === 'va') return 0;
    if (loanType === 'fha') {
        if (ltv <= 0.90) return 0.0050;
        if (ltv <= 0.95) return 0.0055;
        return 0.0060;
    }

    if (ltv <= 0.80) return 0;
    if (ltv <= 0.85) return 0.0030;
    if (ltv <= 0.90) return 0.0052;
    if (ltv <= 0.95) return 0.0075;
    return 0.0095;
};

export const computeMonthlyPayment = (principal, monthlyRate, months) => {
    if (months <= 0 || principal <= 0) return 0;
    if (Math.abs(monthlyRate) < RATE_EPSILON) return principal / months;
    const growth = Math.pow(1 + monthlyRate, months);
    return principal * ((monthlyRate * growth) / (growth - 1));
};

export const computeLoanFromPayment = (payment, monthlyRate, months) => {
    if (months <= 0 || payment <= 0) return 0;
    if (Math.abs(monthlyRate) < RATE_EPSILON) return payment * months;
    const growth = Math.pow(1 + monthlyRate, months);
    return payment * ((growth - 1) / (monthlyRate * growth));
};

export const solveRateFromPayment = (amountFinanced, payment, months) => {
    if (amountFinanced <= 0 || payment <= 0 || months <= 0) return 0;
    if ((payment * months) <= amountFinanced + RATE_EPSILON) return 0;

    let low = 0;
    let high = 1;
    for (let i = 0; i < 80; i += 1) {
        const mid = (low + high) / 2;
        const pv = mid < RATE_EPSILON
            ? payment * months
            : payment * ((1 - Math.pow(1 + mid, -months)) / mid);
        if (pv > amountFinanced) low = mid;
        else high = mid;
    }
    return (low + high) / 2;
};

export const computeMortgageInsuranceForPeriod = ({
    loanType,
    balanceBeforePayment,
    balanceAfterPayment,
    homePrice,
    annualPmiRate,
    periodIndex,
    periodsPerYear,
    originationLtv,
    convPmiDropLtv
}) => {
    if (annualPmiRate <= 0 || balanceBeforePayment <= 0 || homePrice <= 0) return 0;
    if (loanType === 'va') return 0;

    if (loanType === 'conventional') {
        const threshold = clamp(convPmiDropLtv, 0.5, 0.95);
        if (Number.isFinite(balanceAfterPayment) && (balanceAfterPayment / homePrice) <= threshold) return 0;
        if ((balanceBeforePayment / homePrice) <= threshold) return 0;
        return (balanceBeforePayment * annualPmiRate) / periodsPerYear;
    }

    if (loanType === 'fha') {
        const maxYears = originationLtv <= 0.90 ? 11 : Infinity;
        const elapsedYears = periodIndex / periodsPerYear;
        if (elapsedYears >= maxYears) return 0;
        return (balanceBeforePayment * annualPmiRate) / periodsPerYear;
    }

    return 0;
};

export const simulateMortgageSchedule = ({
    loanAmount,
    annualRate,
    termMonths,
    frequency,
    extraMonthly,
    extraPaymentYears,
    lumpSumAmount,
    lumpSumMonth,
    recastEnabled,
    recastFee,
    homePrice,
    loanType,
    annualPmiRate,
    convPmiDropLtv,
    originationLtv
}) => {
    const isBiWeekly = frequency === 'biweekly';
    const periodsPerYear = isBiWeekly ? 26 : 12;
    const monthlyRate = annualRate / 12;
    const periodicRate = isBiWeekly ? (Math.pow(1 + monthlyRate, 12 / 26) - 1) : monthlyRate;
    const totalPeriods = Math.max(1, Math.round((termMonths * periodsPerYear) / 12) + 2);

    const noteMonthlyPayment = computeMonthlyPayment(loanAmount, monthlyRate, termMonths);
    let scheduledPeriodicPayment = isBiWeekly ? (noteMonthlyPayment / 2) : noteMonthlyPayment;
    const initialPeriodicPayment = scheduledPeriodicPayment;

    const extraPerPeriod = Math.max(0, extraMonthly) * (12 / periodsPerYear);
    const extraDurationPeriods = extraPaymentYears > 0
        ? Math.max(1, Math.round(extraPaymentYears * periodsPerYear))
        : 0;
    const lumpPeriod = (lumpSumAmount > 0 && lumpSumMonth > 0)
        ? Math.max(1, Math.round((lumpSumMonth * periodsPerYear) / 12))
        : -1;

    let balance = Math.max(0, loanAmount);
    let totalInterest = 0;
    let totalPmi = 0;
    let totalPaid = 0;
    let firstPeriodPmi = 0;
    let periodsElapsed = 0;
    let recastApplied = false;
    let recastPeriod = 0;
    let recastFeeApplied = 0;

    let yearInterest = 0;
    let yearPrincipal = 0;
    let yearPmi = 0;
    let yearPayment = 0;
    const yearRows = [];
    const yearEndBalances = [];
    const periodRows = [];

    for (let period = 1; period <= totalPeriods && balance > 0.01; period += 1) {
        const balanceBeforePayment = balance;
        const interest = periodicRate > RATE_EPSILON ? (balance * periodicRate) : 0;
        const scheduledPrincipal = Math.max(0, scheduledPeriodicPayment - interest);
        const activeExtraPerPeriod = (extraDurationPeriods > 0 && period <= extraDurationPeriods) ? extraPerPeriod : 0;
        let principal = Math.min(balance, scheduledPrincipal + activeExtraPerPeriod);
        let paymentThisPeriod = interest + principal;
        balance = Math.max(0, balance - principal);

        if (period === lumpPeriod && balance > 0) {
            const lumpApplied = Math.min(balance, lumpSumAmount);
            balance = Math.max(0, balance - lumpApplied);
            principal += lumpApplied;
            paymentThisPeriod += lumpApplied;

            if (recastEnabled && !recastApplied && balance > 0.01) {
                const remainingPeriods = Math.max(1, totalPeriods - period);
                scheduledPeriodicPayment = computeMonthlyPayment(balance, periodicRate, remainingPeriods);
                recastApplied = true;
                recastPeriod = period;
                if (recastFee > 0) {
                    recastFeeApplied = recastFee;
                    totalPaid += recastFee;
                }
            }
        }

        const periodicPmi = computeMortgageInsuranceForPeriod({
            loanType,
            balanceBeforePayment,
            balanceAfterPayment: balance,
            homePrice,
            annualPmiRate,
            periodIndex: period,
            periodsPerYear,
            originationLtv,
            convPmiDropLtv
        });

        if (period === 1) firstPeriodPmi = periodicPmi;

        totalInterest += interest;
        totalPmi += periodicPmi;
        totalPaid += paymentThisPeriod + periodicPmi;
        periodsElapsed = period;

        yearInterest += interest;
        yearPrincipal += principal;
        yearPmi += periodicPmi;
        yearPayment += paymentThisPeriod + periodicPmi;

        periodRows.push({
            period,
            year: Math.ceil(period / periodsPerYear),
            monthApprox: period * (12 / periodsPerYear),
            interest,
            principal,
            pmi: periodicPmi,
            payment: paymentThisPeriod + periodicPmi,
            balance: Math.max(0, balance)
        });

        if ((period % periodsPerYear === 0) || balance <= 0.01) {
            yearRows.push({
                year: Math.ceil(period / periodsPerYear),
                interest: yearInterest,
                principal: yearPrincipal,
                pmi: yearPmi,
                payment: yearPayment,
                balance: Math.max(0, balance)
            });
            yearEndBalances.push(Math.max(0, balance));
            yearInterest = 0;
            yearPrincipal = 0;
            yearPmi = 0;
            yearPayment = 0;
        }
    }

    return {
        periodsPerYear,
        periodicRate,
        initialPeriodicPayment,
        finalPeriodicPayment: scheduledPeriodicPayment,
        periodsElapsed,
        monthsElapsed: periodsElapsed * (12 / periodsPerYear),
        totalInterest,
        totalPmi,
        totalPaid,
        firstPeriodPmi,
        recastApplied,
        recastPeriod,
        recastFeeApplied,
        yearRows,
        yearEndBalances,
        periodRows
    };
};

export const simulateFixedPaymentLoan = ({ balance, monthlyRate, payment, maxMonths = 1200 }) => {
    let remaining = balance;
    let totalInterest = 0;
    let totalPaid = 0;
    let months = 0;
    const cumulative = [];

    if (remaining <= 0 || payment <= 0) return { months: 0, totalInterest: 0, totalPaid: 0, cumulative };
    if (monthlyRate > RATE_EPSILON && payment <= (remaining * monthlyRate) + RATE_EPSILON) {
        return { months: Infinity, totalInterest: Infinity, totalPaid: Infinity, cumulative: [] };
    }

    while (remaining > 0.01 && months < maxMonths) {
        const interest = monthlyRate > RATE_EPSILON ? remaining * monthlyRate : 0;
        const principal = Math.min(remaining, Math.max(0, payment - interest));
        const actualPayment = principal + interest;
        remaining -= principal;
        totalInterest += interest;
        totalPaid += actualPayment;
        months += 1;
        cumulative.push(totalPaid);
    }
    return { months, totalInterest, totalPaid, cumulative };
};
