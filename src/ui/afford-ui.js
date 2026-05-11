import { computeLoanFromPayment } from '../core/mortgage-core.js';

export const createAffordabilityCalculator = ({
    state,
    getVal,
    getSelectVal,
    clamp,
    formatMoney,
    formatPercent,
    renderWarnings,
    updateModeVisibility,
    syncChart
}) => {
    const calcAffordability = () => {
        updateModeVisibility();
        const mode = getSelectVal('affordMode', 'simple');
        const isExpert = mode === 'expert';
        const income = getVal('affordIncome') / 12;
        const debts = getVal('affordDebts');
        const down = getVal('affordDown');
        const fixed = getVal('affordFixed');
        const noteAnnualRate = getVal('affordRate') / 100;
        const stressAnnualRate = isExpert ? (getVal('affordStressRate') / 100) : noteAnnualRate;
        const frontDti = isExpert ? clamp(getVal('affordFrontDti') / 100, 0, 1) : 0.28;
        const backDti = isExpert ? clamp(getVal('affordBackDti') / 100, 0, 1) : 0.36;
        const termMonths = (getVal('loanTerm') || 30) * 12;

        const qualifyingAnnualRate = Math.max(noteAnnualRate, stressAnnualRate);
        const qualifyingMonthlyRate = qualifyingAnnualRate / 12;

        const frontMaxPI = (income * frontDti) - fixed;
        const backMaxPI = (income * backDti) - debts - fixed;
        const maxPI = Math.max(0, Math.min(frontMaxPI, backMaxPI));
        const maxLoan = computeLoanFromPayment(maxPI, qualifyingMonthlyRate, termMonths);
        const maxPrice = maxLoan + down;

        document.getElementById('maxHomePrice').innerText = formatMoney(maxPrice);
        let limitingRule = 'Front and back DTI are equally binding.';
        if (frontMaxPI < backMaxPI) limitingRule = 'Front-end DTI is binding.';
        if (backMaxPI < frontMaxPI) limitingRule = 'Back-end DTI is binding.';
        if (maxPI <= 0) limitingRule = 'No qualifying payment room under current assumptions.';
        document.getElementById('affordConstraint').innerText = `Qualifying rate: ${formatPercent(qualifyingAnnualRate)}. ${limitingRule}`;

        if (typeof Chart !== 'undefined') {
            try {
                const housingCost = clamp(maxPI + fixed, 0, income);
                const debtCost = clamp(debts, 0, Math.max(0, income - housingCost));
                const remaining = Math.max(0, income - housingCost - debtCost);
                state.affordChart = syncChart(state.affordChart, document.getElementById('affordChart'), {
                    type: 'pie',
                    data: {
                        labels: ['Housing', 'Debts', 'Remaining'],
                        datasets: [{ data: [housingCost, debtCost, remaining], backgroundColor: ['#10b981', '#f43f5e', '#e5e7eb'] }]
                    },
                    options: {}
                });
            } catch (e) {
                console.error('Afford chart error:', e);
            }
        }

        const warnings = [];
        if (isExpert && frontDti > backDti) warnings.push('Front-end DTI is above back-end DTI; this is uncommon underwriting policy.');
        if (isExpert && qualifyingAnnualRate >= 0.10) warnings.push('Stress-test rate is very high; affordability may be intentionally conservative.');
        if (maxPI <= 0) warnings.push('Housing budget is negative or zero after debts/fixed costs.');
        renderWarnings('affordWarnings', warnings);
    };

    return { calcAffordability };
};
