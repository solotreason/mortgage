import { computeMonthlyPayment, solveRateFromPayment, simulateMortgageSchedule } from '../core/mortgage-core.js';

export const createMortgageCalculator = ({
    state,
    getVal,
    getChecked,
    getSelectVal,
    getConventionalPmiThresholdPct,
    buildLoanCostProfile,
    formatMoney,
    formatPercent,
    setCashToCloseBreakdown,
    renderMortgageInsights,
    getBreakdownChartPayload,
    isPopupOpen,
    renderBreakdownPopupContent,
    renderAmortizationPopupTable,
    renderWarnings
}) => {
    const calcMortgage = () => {
        const homePrice = getVal('homePrice');
        const downPayment = getVal('downPayment');
        const annualRate = getVal('interestRate') / 100;
        const termMonths = getVal('loanTerm') * 12;
        const loanType = getSelectVal('loanType', 'conventional');
        const taxMonthly = getVal('propertyTax') / 12;
        const insuranceMonthly = getVal('homeInsurance') / 12;
        const hoaMonthly = getVal('hoaFee');
        const annualPmiRate = getVal('pmiRate') / 100;
        const convPmiDropLtv = getConventionalPmiThresholdPct() / 100;
        const extraMonthly = getVal('extraPayment');
        const extraPaymentYears = getVal('extraPaymentYears');
        const isBiWeekly = getChecked('biWeeklyToggle');
        const lumpSumAmount = getVal('lumpSumAmount');
        const lumpSumMonth = getVal('lumpSumMonth');
        const recastEnabled = getChecked('recastToggle');
        const recastFee = getVal('recastFee');

        if (homePrice <= 0 || termMonths <= 0) return;

        const loanProfile = buildLoanCostProfile({ homePrice, downPayment, loanType });
        const originationLtv = homePrice > 0 ? (loanProfile.baseLoan / homePrice) : 1;

        const schedule = simulateMortgageSchedule({
            loanAmount: loanProfile.noteLoanAmount,
            annualRate,
            termMonths,
            frequency: isBiWeekly ? 'biweekly' : 'monthly',
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
        });

        const requiredMortgageMonthly = isBiWeekly
            ? (schedule.initialPeriodicPayment * 26 / 12)
            : schedule.initialPeriodicPayment;
        const firstPeriodPmiMonthly = schedule.firstPeriodPmi * (schedule.periodsPerYear / 12);
        const totalMonthly = requiredMortgageMonthly + firstPeriodPmiMonthly + taxMonthly + insuranceMonthly + hoaMonthly;

        document.getElementById('totalMonthlyDisplay').innerText = formatMoney(totalMonthly);
        document.getElementById('mobileStickyMonthly').innerText = formatMoney(totalMonthly);
        document.getElementById('cashToCloseDisplay').innerText = formatMoney(loanProfile.upfrontCashToClose);
        document.getElementById('totalInterestDisplay').innerText = formatMoney(schedule.totalInterest);

        const noteMonthlyPayment = computeMonthlyPayment(loanProfile.noteLoanAmount, annualRate / 12, termMonths);
        const aprMonthly = solveRateFromPayment(loanProfile.amountFinancedApr, noteMonthlyPayment, termMonths);
        const aprNominalAnnual = aprMonthly * 12;
        const aprEffectiveAnnual = Math.pow(1 + aprMonthly, 12) - 1;
        const aprEl = document.getElementById('aprDisplay');
        aprEl.innerText = `${(aprNominalAnnual * 100).toFixed(2)}%`;
        aprEl.title = `Effective annual cost: ${(aprEffectiveAnnual * 100).toFixed(2)}%`;

        const baseLtv = homePrice > 0 ? (loanProfile.baseLoan / homePrice) : 0;
        const noteLtv = homePrice > 0 ? (loanProfile.noteLoanAmount / homePrice) : 0;
        const ltvEl = document.getElementById('ltvDisplay');
        ltvEl.innerText = formatPercent(baseLtv, 2);
        ltvEl.title = `Base loan: ${formatMoney(loanProfile.baseLoan)}. Note amount with financed costs: ${formatMoney(loanProfile.noteLoanAmount)} (${formatPercent(noteLtv, 2)} LTV).`;

        const govtFeeLabel = loanType === 'fha' ? 'FHA UFMIP' : 'VA Funding Fee';
        const breakdownRows = [
            { label: 'Down Payment', value: loanProfile.effectiveDownPayment },
            { label: 'Prepaids / Escrows', value: loanProfile.prepaidItems }
        ];
        if (loanProfile.govtFeeAmount > 0) {
            breakdownRows.push({ label: `${govtFeeLabel} (Upfront)`, value: loanProfile.upfrontGovtFee });
            breakdownRows.push({ label: `${govtFeeLabel} (Financed)`, value: loanProfile.financedGovtFee });
        }
        breakdownRows.push({ label: 'Discount Points (Upfront)', value: loanProfile.upfrontPoints });
        breakdownRows.push({ label: 'Discount Points (Financed)', value: loanProfile.financedPoints });
        breakdownRows.push({ label: 'Lender + Other Costs (Upfront)', value: loanProfile.upfrontOtherCosts });
        breakdownRows.push({ label: 'Lender + Other Costs (Financed)', value: loanProfile.financedOtherCosts });
        setCashToCloseBreakdown(breakdownRows);

        state.latestMortgageSchedule = schedule;
        state.latestPaymentBreakdownRows = [
            { label: 'P&I', value: requiredMortgageMonthly },
            { label: 'Tax', value: taxMonthly },
            { label: 'Insurance', value: insuranceMonthly },
            { label: 'HOA', value: hoaMonthly }
        ];
        if (firstPeriodPmiMonthly > 0) state.latestPaymentBreakdownRows.push({ label: 'PMI/MIP', value: firstPeriodPmiMonthly });

        renderMortgageInsights({
            schedule,
            loanProfile,
            loanType,
            homePrice,
            annualRate,
            termMonths,
            isBiWeekly,
            requiredMortgageMonthly,
            firstPeriodPmiMonthly,
            taxMonthly,
            insuranceMonthly,
            hoaMonthly,
            totalMonthly
        });

        const tbody = document.getElementById('amortizationBody');
        tbody.replaceChildren();
        schedule.yearRows.forEach((row) => {
            const tr = document.createElement('tr');
            [
                `Yr ${row.year}`,
                formatMoney(row.interest),
                formatMoney(row.principal),
                formatMoney(row.balance)
            ].forEach((value) => {
                const td = document.createElement('td');
                td.className = 'px-6 py-2';
                td.innerText = value;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        if (typeof Chart !== 'undefined') {
            try {
                if (state.breakdownChart) state.breakdownChart.destroy();
                const payload = getBreakdownChartPayload();
                state.breakdownChart = new Chart(document.getElementById('breakdownChart'), {
                    type: 'doughnut',
                    data: { labels: payload.labels, datasets: [{ data: payload.data, backgroundColor: payload.colors }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
                });
            } catch (e) {
                console.error('Chart error:', e);
            }
        }

        if (isPopupOpen('breakdownPopup')) renderBreakdownPopupContent();
        if (isPopupOpen('amortizationPopup')) renderAmortizationPopupTable();

        const warnings = [];
        const annualTaxRate = homePrice > 0 ? (getVal('propertyTax') / homePrice) : 0;
        const annualInsRate = homePrice > 0 ? (getVal('homeInsurance') / homePrice) : 0;
        if (downPayment > homePrice) warnings.push('Down payment exceeds home price; values are clamped to valid bounds.');
        if (annualTaxRate > 0 && (annualTaxRate < 0.002 || annualTaxRate > 0.04)) warnings.push(`Property tax rate (${formatPercent(annualTaxRate)}) looks outside typical ranges.`);
        if (annualInsRate > 0 && (annualInsRate < 0.001 || annualInsRate > 0.02)) warnings.push(`Insurance rate (${formatPercent(annualInsRate)}) looks outside typical ranges.`);
        if (annualRate > 0.12) warnings.push('Interest rate is very high. Confirm rate/points assumptions.');
        if (loanProfile.baseLoan <= loanProfile.upfrontFinanceCharges) warnings.push('Upfront finance charges are very high relative to loan amount; APR may be distorted.');
        if (recastEnabled && lumpSumAmount <= 0) warnings.push('Recast is enabled, but no lump-sum payment is scheduled.');
        if (isBiWeekly) warnings.push('Bi-weekly mode is modeled as 26 half-payments per year.');
        if (schedule.recastApplied) {
            const recastMonthApprox = Math.round(schedule.recastPeriod * (12 / schedule.periodsPerYear));
            const newPaymentMonthly = isBiWeekly ? (schedule.finalPeriodicPayment * 26 / 12) : schedule.finalPeriodicPayment;
            warnings.push(`Recast applied near month ${recastMonthApprox}; new scheduled payment is ${formatMoney(newPaymentMonthly)}.`);
        }
        renderWarnings('assumptionWarnings', warnings);
    };

    return { calcMortgage };
};
