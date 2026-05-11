export const createRentBuyCalculator = ({
    state,
    getVal,
    getSelectVal,
    clamp,
    formatMoney,
    formatPercent,
    formatBreakEven,
    renderWarnings,
    updateModeVisibility,
    syncChart,
    getConventionalPmiThresholdPct,
    runRentVsBuyScenario
}) => {
    const calcRentVsBuy = () => {
        updateModeVisibility();
        const mode = getSelectVal('rbMode', 'simple');
        const isExpert = mode === 'expert';
        const price = getVal('rbPrice');
        const monthlyRentStart = getVal('rbRent');
        const appreciation = getVal('rbApprec') / 100;
        const rentInflation = getVal('rbRentInf') / 100;
        const maintenanceRate = getVal('rbMaint') / 100;
        const buyClosingRate = getVal('rbClosing') / 100;
        const opportunityAnnualReturn = isExpert ? (getVal('rbInvestReturn') / 100) : 0;
        const taxTreatment = isExpert ? getSelectVal('rbTaxTreatment', 'none') : 'none';
        const marginalTaxRate = isExpert ? (getVal('rbMarginalTax') / 100) : 0;
        const standardDeduction = isExpert ? getVal('rbStdDeduction') : 0;

        if (price <= 0 || monthlyRentStart <= 0) return;

        const referenceHomePrice = getVal('homePrice');
        const downPct = clamp((getVal('downPaymentPercent') / 100) || 0.20, 0, 0.95);
        const annualRate = (getVal('interestRate') / 100) || 0.065;
        const termMonths = (getVal('loanTerm') || 30) * 12;
        const annualPmiRate = getVal('pmiRate') / 100;
        const convPmiDropLtv = getConventionalPmiThresholdPct() / 100;
        const loanType = getSelectVal('loanType', 'conventional');
        const taxRate = referenceHomePrice > 0 ? (getVal('propertyTax') / referenceHomePrice) : 0.015;
        const insuranceRate = referenceHomePrice > 0 ? (getVal('homeInsurance') / referenceHomePrice) : 0.01;
        const hoaMonthly = getVal('hoaFee');
        const baseParams = {
            price,
            monthlyRentStart,
            appreciation,
            rentInflation,
            maintenanceRate,
            buyClosingRate,
            opportunityAnnualReturn,
            taxTreatment,
            marginalTaxRate,
            standardDeduction,
            downPct,
            annualRate,
            termMonths,
            annualPmiRate,
            convPmiDropLtv,
            loanType,
            taxRate,
            insuranceRate,
            hoaMonthly,
            saleCostRate: 0.06
        };

        const baseResult = runRentVsBuyScenario(baseParams);

        if (typeof Chart !== 'undefined') {
            try {
                state.rentBuyChart = syncChart(state.rentBuyChart, document.getElementById('rentBuyChart'), {
                    type: 'line',
                    data: {
                        labels: Array.from({ length: 10 }, (_, index) => `Yr ${index + 1}`),
                        datasets: [
                            { label: 'Rent Net Cost (with invested savings)', data: baseResult.rentData, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.3 },
                            { label: 'Buy Net Cost (equity + tax adjusted)', data: baseResult.buyData, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.3 }
                        ]
                    },
                    options: { interaction: { mode: 'index', intersect: false } }
                });
            } catch (e) {
                console.error('RentBuy chart error:', e);
            }
        }

        const finalAdvantage = baseResult.finalRentCost - baseResult.finalBuyCost;
        const verdict = document.getElementById('rbVerdict');
        if (finalAdvantage > 0) {
            verdict.innerText = `Buying is better by ${formatMoney(finalAdvantage)} over 10 years. ${formatBreakEven(baseResult.breakEvenMonth)}.`;
            verdict.className = 'mt-6 p-4 bg-emerald-50 text-emerald-800 rounded-xl font-bold border border-emerald-200';
        } else {
            verdict.innerText = `Renting is better by ${formatMoney(Math.abs(finalAdvantage))} over 10 years. ${formatBreakEven(baseResult.breakEvenMonth)}.`;
            verdict.className = 'mt-6 p-4 bg-red-50 text-red-800 rounded-xl font-bold border border-red-200';
        }

        const scenarioBody = document.getElementById('rbScenarioBody');
        scenarioBody.replaceChildren();

        if (isExpert) {
            const scenarioDefs = [
                { name: 'Best', appreciationDelta: 0.01, rentDelta: 0.01, rateDelta: -0.0075 },
                { name: 'Base', appreciationDelta: 0, rentDelta: 0, rateDelta: 0 },
                { name: 'Worst', appreciationDelta: -0.01, rentDelta: -0.01, rateDelta: 0.0075 }
            ];
            scenarioDefs.forEach((scenario) => {
                const scenarioParams = {
                    ...baseParams,
                    appreciation: clamp(baseParams.appreciation + scenario.appreciationDelta, -0.02, 0.15),
                    rentInflation: clamp(baseParams.rentInflation + scenario.rentDelta, -0.02, 0.20),
                    annualRate: Math.max(0, baseParams.annualRate + scenario.rateDelta)
                };
                const result = runRentVsBuyScenario(scenarioParams);
                const advantage = result.finalRentCost - result.finalBuyCost;
                const advantageText = advantage >= 0
                    ? `Buy +${formatMoney(advantage)}`
                    : `Rent +${formatMoney(Math.abs(advantage))}`;

                const tr = document.createElement('tr');
                const cells = [
                    { value: scenario.name, className: 'px-4 py-2 font-medium text-gray-900' },
                    { value: formatBreakEven(result.breakEvenMonth), className: 'px-4 py-2 text-gray-700' },
                    { value: advantageText, className: 'px-4 py-2 text-gray-700' }
                ];
                cells.forEach((cell) => {
                    const td = document.createElement('td');
                    td.className = cell.className;
                    td.innerText = cell.value;
                    tr.appendChild(td);
                });
                scenarioBody.appendChild(tr);
            });
        }

        const warnings = [];
        if (isExpert && taxRate > 0 && (taxRate < 0.002 || taxRate > 0.04)) warnings.push(`Property tax rate (${formatPercent(taxRate)}) may be unrealistic for this market.`);
        if (isExpert && insuranceRate > 0 && (insuranceRate < 0.001 || insuranceRate > 0.02)) warnings.push(`Insurance rate (${formatPercent(insuranceRate)}) may be unrealistic for this market.`);
        if (isExpert && appreciation > 0.08) warnings.push('Home appreciation above 8% annually is aggressive for long-term planning.');
        if (isExpert && rentInflation > 0.10) warnings.push('Rent inflation above 10% annually is aggressive for long-term planning.');
        if (isExpert && (opportunityAnnualReturn > 0.15 || opportunityAnnualReturn < -0.05)) warnings.push('Investment return assumption is extreme; scenario sensitivity matters.');
        if (baseResult.breakEvenMonth === null) warnings.push('Buying does not break even within 10 years under base assumptions.');
        renderWarnings('rbWarnings', warnings);
    };

    return { calcRentVsBuy };
};
