import { RATE_EPSILON, computeMonthlyPayment, simulateFixedPaymentLoan } from '../core/mortgage-core.js';

export const createRefinanceCalculator = ({
    state,
    getVal,
    formatMoney
}) => {
    const calcRefinance = () => {
        const balance = getVal('refiBal');
        const oldPayment = getVal('refiPayOld');
        const oldMonthlyRate = getVal('refiRateOld') / 100 / 12;
        const newMonthlyRate = getVal('refiRateNew') / 100 / 12;
        const newTermMonths = getVal('refiTermNew') * 12;
        const closingCosts = getVal('refiCost');

        if (balance <= 0 || oldPayment <= 0 || newTermMonths <= 0) return;

        const remainingCurrent = simulateFixedPaymentLoan({ balance, monthlyRate: oldMonthlyRate, payment: oldPayment });
        const newPayment = computeMonthlyPayment(balance, newMonthlyRate, newTermMonths);
        const newLoan = simulateFixedPaymentLoan({ balance, monthlyRate: newMonthlyRate, payment: newPayment, maxMonths: newTermMonths + 2 });

        document.getElementById('refiNewPay').innerText = formatMoney(newPayment);
        document.getElementById('refiOldTermLeft').innerText = Number.isFinite(remainingCurrent.months) ? `${remainingCurrent.months} Mo` : 'N/A';

        const monthlySavings = oldPayment - newPayment;
        const hasFiniteCurrentTerm = Number.isFinite(remainingCurrent.months);
        document.getElementById('refiSaveMo').innerText = formatMoney(monthlySavings);

        if (!hasFiniteCurrentTerm) {
            document.getElementById('refiBreak').innerText = 'N/A';
            document.getElementById('refiAdvice').innerText = 'Current payment does not fully amortize the balance.';
        } else if (monthlySavings > RATE_EPSILON) {
            const monthsToBreakEven = closingCosts > 0 ? closingCosts / monthlySavings : 0;
            document.getElementById('refiBreak').innerText = `${monthsToBreakEven.toFixed(1)} Mo`;
            const totalDifference = remainingCurrent.totalPaid - (newLoan.totalPaid + closingCosts);

            if (totalDifference > 0) {
                document.getElementById('refiAdvice').innerText = `Estimated lifetime savings: ${formatMoney(totalDifference)}. Refinancing favorable after ${monthsToBreakEven.toFixed(1)} months.`;
            } else {
                document.getElementById('refiAdvice').innerText = 'Payment drops, but total remaining cost is higher due to term/costs.';
            }
        } else {
            document.getElementById('refiBreak').innerText = 'N/A';
            document.getElementById('refiAdvice').innerText = 'Payment increases. Usually only makes sense for cash-out or shorter terms.';
        }

        const chartLength = hasFiniteCurrentTerm ? Math.max(remainingCurrent.months, newLoan.months) : newLoan.months;
        const oldData = [];
        const newData = [];
        for (let month = 0; month < chartLength; month += 1) {
            if (hasFiniteCurrentTerm) oldData.push(remainingCurrent.cumulative[month] ?? remainingCurrent.totalPaid);
            else oldData.push(oldPayment * (month + 1));
            newData.push((newLoan.cumulative[month] ?? newLoan.totalPaid) + closingCosts);
        }

        if (typeof Chart !== 'undefined') {
            try {
                if (state.refiChart) state.refiChart.destroy();
                state.refiChart = new Chart(document.getElementById('refiChart'), {
                    type: 'line',
                    data: {
                        labels: Array.from({ length: chartLength }, (_, i) => `Mo ${i + 1}`),
                        datasets: [
                            { label: 'Current Loan', data: oldData, borderColor: '#9ca3af', borderDash: [5, 5], pointRadius: 0 },
                            { label: 'Refi Cost', data: newData, borderColor: '#8b5cf6', fill: true, backgroundColor: 'rgba(139, 92, 246, 0.1)', pointRadius: 0 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false } }
                });
            } catch (e) {
                console.error('Refi chart error:', e);
            }
        }
    };

    return { calcRefinance };
};
