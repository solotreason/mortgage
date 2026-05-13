import {
    estimateAnnualMortgageInsuranceRate,
    computeMonthlyPayment,
    computeMortgageInsuranceForPeriod
} from './src/core/mortgage-core.js';
import { createMortgageCalculator } from './src/ui/mortgage-ui.js';
import { createAffordabilityCalculator } from './src/ui/afford-ui.js';
import { createRentBuyCalculator } from './src/ui/rentbuy-ui.js';
import { createRefinanceCalculator } from './src/ui/refinance-ui.js';

// --- UTILS ---
        const formatMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number.isFinite(n) ? n : 0);
        const formatWholeMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
        const formatPercent = (n, digits = 2) => `${(Number.isFinite(n) ? n * 100 : 0).toFixed(digits)}%`;
        const LISTING_SOURCE_DOMAINS = Object.freeze({
            realtor: ['realtor.com']
        });

        const getListingSourceFromUrl = (rawUrl) => {
            let parsed;
            try {
                parsed = new URL(String(rawUrl ?? '').trim());
            } catch (error) {
                return null;
            }

            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
            const host = parsed.hostname.toLowerCase();
            for (const [source, domains] of Object.entries(LISTING_SOURCE_DOMAINS)) {
                if (domains.some(domain => host === domain || host.endsWith(`.${domain}`))) {
                    return { source, url: parsed.toString(), hostname: host };
                }
            }
            return null;
        };

        const getVal = (id) => {
            const el = document.getElementById(id);
            if (!el) return 0;
            return Math.max(0, parseFloat(String(el.value).replace(/,/g, '')) || 0);
        };

        const getChecked = (id) => Boolean(document.getElementById(id)?.checked);
        const getSelectVal = (id, fallback = '') => document.getElementById(id)?.value ?? fallback;
        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const setCurrencyInput = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;
            const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
            el.value = safe.toLocaleString('en-US', { maximumFractionDigits: 2 });
        };
        const setNumberInput = (id, value, digits = 2) => {
            const el = document.getElementById(id);
            if (!el) return;
            const safe = Number.isFinite(value) ? value : 0;
            el.value = safe.toFixed(digits);
        };

        const CHART_ANIMATION = Object.freeze({
            duration: 560,
            easing: 'easeOutQuart'
        });

        const syncChartInstance = (existingChart, canvas, config) => {
            if (typeof Chart === 'undefined' || !canvas) return existingChart ?? null;

            const nextLabels = Array.isArray(config?.data?.labels) ? [...config.data.labels] : [];
            const nextDatasets = Array.isArray(config?.data?.datasets)
                ? config.data.datasets.map((dataset) => ({
                    ...dataset,
                    data: Array.isArray(dataset.data) ? [...dataset.data] : dataset.data
                }))
                : [];
            const configuredAnimation = config?.options?.animation && typeof config.options.animation === 'object'
                ? config.options.animation
                : {};
            const nextOptions = config?.options
                ? {
                    responsive: true,
                    maintainAspectRatio: false,
                    ...config.options,
                    animation: {
                        ...CHART_ANIMATION,
                        ...configuredAnimation
                    }
                }
                : {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: CHART_ANIMATION
                };

            if (!existingChart || !existingChart.canvas) {
                return new Chart(canvas, {
                    type: config?.type ?? 'line',
                    data: {
                        labels: nextLabels,
                        datasets: nextDatasets
                    },
                    options: nextOptions
                });
            }

            existingChart.data.labels = nextLabels;
            existingChart.data.datasets = nextDatasets;
            existingChart.update();
            return existingChart;
        };

        const DEV_API_PORT = 63343;
        const LEGACY_DEV_API_PORT = 4173;
        const buildApiOriginCandidates = () => {
            const candidates = [];
            if (typeof window !== 'undefined' && window.location) {
                const currentOrigin = String(window.location.origin ?? '').trim();
                const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
                const hostname = window.location.hostname || 'localhost';
                const currentPort = String(window.location.port ?? '').trim();
                if (currentPort === '63342') {
                    candidates.push(`${protocol}//${hostname}:${DEV_API_PORT}`);
                }
                if (/^https?:\/\//i.test(currentOrigin)) candidates.push(currentOrigin);
                if (currentPort !== '63342') {
                    candidates.push(`${protocol}//${hostname}:${DEV_API_PORT}`);
                }
                candidates.push(`${protocol}//${hostname}:${LEGACY_DEV_API_PORT}`);
            } else {
                candidates.push(`http://localhost:${DEV_API_PORT}`);
                candidates.push(`http://localhost:${LEGACY_DEV_API_PORT}`);
            }
            return [...new Set(candidates)];
        };

        const buildApiUrlCandidates = (pathAndQuery) => {
            const target = String(pathAndQuery ?? '').trim();
            if (!target) return [];
            if (/^https?:\/\//i.test(target)) return [target];
            const suffix = target.startsWith('/') ? target : `/${target}`;
            return buildApiOriginCandidates().map((origin) => `${origin}${suffix}`);
        };

        const fetchApiJsonWithTimeout = async (pathAndQuery, timeoutMs = 12000, externalSignal = null) => {
            let lastError = null;
            for (const url of buildApiUrlCandidates(pathAndQuery)) {
                try {
                    return await fetchJsonWithTimeout(url, timeoutMs, externalSignal);
                } catch (error) {
                    lastError = error;
                }
            }
            throw (lastError ?? new Error('api-fetch-failed'));
        };

        const RATE_EPSILON = 1e-10;
        const SALT_CAP_ANNUAL = 10000;
        const LISTING_COSTS_ENDPOINT = '/api/listing-costs';
        const FRED_SERIES_BY_TERM = Object.freeze({
            15: 'MORTGAGE15US',
            30: 'MORTGAGE30US'
        });
        const LIVE_RATE_PROXY_ENDPOINT = '/api/live-rate';
        const STATIC_LIVE_RATES_ENDPOINT = 'data/live-rates.json';
        const FRED_CSV_ENDPOINTS_BY_SERIES = (seriesId) => ([
            `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
            `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}/downloaddata/${encodeURIComponent(seriesId)}.csv`
        ]);
        const STAY_AFLOAT_POLICY_VERSION = 'Stay Afloat Policy v1';
        const LOCATION_QUALITY_META = {
            realtor: {
                label: 'Realtor listing',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-50 border-red-200 text-red-800'
            },
            listing: {
                label: 'Listing URL',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 border-emerald-200 text-emerald-800'
            },
            unknown: {
                label: 'Not applied',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-indigo-50 border-indigo-200 text-indigo-700'
            }
        };
        const locationEstimateState = {
            source: 'unknown',
            sourceYear: null,
            sourceName: '',
            sourceUrl: '',
            propertyFacts: null,
            taxInsight: '',
            hoaInsight: '',
            fetchInsight: ''
        };
        const REQUEST_GUARD_WINDOW_MS = 60000;
        const REQUEST_GUARD_MAX_PER_WINDOW = 60;
        const REQUEST_GUARD_MAX_PER_SESSION = 400;
        const requestGuardState = new Map();

        const toFiniteNumber = (value) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const guardExternalRequest = (url) => {
            const host = (() => {
                try {
                    return new URL(url).host;
                } catch (error) {
                    return 'unknown';
                }
            })();
            const now = Date.now();
            const state = requestGuardState.get(host) ?? { windowStart: now, windowCount: 0, sessionCount: 0 };
            if ((now - state.windowStart) > REQUEST_GUARD_WINDOW_MS) {
                state.windowStart = now;
                state.windowCount = 0;
            }
            state.windowCount += 1;
            state.sessionCount += 1;
            requestGuardState.set(host, state);

            if (state.windowCount > REQUEST_GUARD_MAX_PER_WINDOW) {
                throw new Error(`rate-limit-window-${host}`);
            }
            if (state.sessionCount > REQUEST_GUARD_MAX_PER_SESSION) {
                throw new Error(`rate-limit-session-${host}`);
            }
        };

        const fetchJsonWithTimeout = async (url, timeoutMs = 12000, externalSignal = null) => {
            guardExternalRequest(url);
            const controller = new AbortController();
            const onAbort = () => controller.abort();
            if (externalSignal) {
                if (externalSignal.aborted) controller.abort();
                else externalSignal.addEventListener('abort', onAbort, { once: true });
            }
            const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } finally {
                clearTimeout(timeoutHandle);
                if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
            }
        };

        const fetchTextWithTimeout = async (url, timeoutMs = 12000, externalSignal = null) => {
            guardExternalRequest(url);
            const controller = new AbortController();
            const onAbort = () => controller.abort();
            if (externalSignal) {
                if (externalSignal.aborted) controller.abort();
                else externalSignal.addEventListener('abort', onAbort, { once: true });
            }
            const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.text();
            } finally {
                clearTimeout(timeoutHandle);
                if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
            }
        };

        const resolveFredSeriesForTerm = (termYears) => {
            const roundedTerm = Math.round(Number.isFinite(termYears) ? termYears : 30);
            if (roundedTerm === 15) {
                return {
                    seriesId: FRED_SERIES_BY_TERM[15],
                    exactMatch: true,
                    requestedTerm: roundedTerm
                };
            }
            return {
                seriesId: FRED_SERIES_BY_TERM[30],
                exactMatch: roundedTerm === 30,
                requestedTerm: roundedTerm
            };
        };

        const parseLatestObservationFromFredCsv = (csvText) => {
            const lines = String(csvText ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            if (lines.length < 2) return null;
            for (let i = lines.length - 1; i >= 1; i -= 1) {
                const parts = lines[i].split(',');
                if (parts.length < 2) continue;
                const date = String(parts[0] ?? '').trim();
                const rawValue = String(parts[1] ?? '').trim().replace(/^"|"$/g, '');
                const rate = Number.parseFloat(rawValue);
                if (!date || !Number.isFinite(rate)) continue;
                return { date, rate };
            }
            return null;
        };

        const isLocalApiHost = () => {
            if (typeof window === 'undefined' || !window.location) return false;
            const hostname = String(window.location.hostname ?? '').toLowerCase();
            return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || window.location.protocol === 'file:';
        };

        const fetchStaticLiveRate = async (seriesSelection) => {
            const cacheBust = `v=${encodeURIComponent(String(Date.now()))}`;
            const separator = STATIC_LIVE_RATES_ENDPOINT.includes('?') ? '&' : '?';
            const payload = await fetchJsonWithTimeout(`${STATIC_LIVE_RATES_ENDPOINT}${separator}${cacheBust}`, 12000);
            const series = payload?.series?.[seriesSelection.seriesId] ?? null;
            const date = String(series?.date ?? '').trim();
            const rate = Number.parseFloat(series?.rate);
            if (!date || !Number.isFinite(rate)) throw new Error(`static-live-rate-missing-${seriesSelection.seriesId}`);
            return {
                ...seriesSelection,
                date,
                rate
            };
        };

        const fetchLatestFreddieMacRate = async (termYears) => {
            const seriesSelection = resolveFredSeriesForTerm(termYears);
            if (isLocalApiHost()) {
                try {
                    const payload = await fetchApiJsonWithTimeout(`${LIVE_RATE_PROXY_ENDPOINT}?series=${encodeURIComponent(seriesSelection.seriesId)}`, 12000);
                    const date = String(payload?.date ?? '').trim();
                    const rate = Number.parseFloat(payload?.rate);
                    if (date && Number.isFinite(rate)) {
                        return {
                            ...seriesSelection,
                            date,
                            rate
                        };
                    }
                } catch (error) {
                    // Local proxy may be unavailable. Continue through static and direct sources.
                }
            }

            try {
                return await fetchStaticLiveRate(seriesSelection);
            } catch (error) {
                // GitHub Pages serves this file from the repo. If it is missing, try direct FRED fetch.
            }

            const endpoints = FRED_CSV_ENDPOINTS_BY_SERIES(seriesSelection.seriesId);
            let lastError = null;
            for (const endpoint of endpoints) {
                try {
                    const csvText = await fetchTextWithTimeout(endpoint, 15000);
                    const observation = parseLatestObservationFromFredCsv(csvText);
                    if (!observation) throw new Error(`no-observation-${seriesSelection.seriesId}`);
                    return {
                        ...seriesSelection,
                        ...observation
                    };
                } catch (error) {
                    lastError = error;
                }
            }
            throw (lastError ?? new Error('fred-rate-fetch-failed'));
        };

        const setLocationQualityBadge = (source = 'unknown', sourceYear = null) => {
            const badgeEl = document.getElementById('locationQualityBadge');
            if (!badgeEl) return;
            const meta = LOCATION_QUALITY_META[source] ?? LOCATION_QUALITY_META.unknown;
            badgeEl.className = meta.className;
            badgeEl.innerText = sourceYear ? `${meta.label} (${sourceYear})` : meta.label;
        };

        const renderWarnings = (containerId, messages) => {
            const el = document.getElementById(containerId);
            if (!el) return;

            if (!messages.length) {
                el.className = 'hidden p-4 rounded-xl border text-sm';
                el.replaceChildren();
                return;
            }

            el.className = 'p-4 rounded-xl border text-sm bg-amber-50 border-amber-200 text-amber-800';
            el.replaceChildren();
            messages.forEach((msg) => {
                const row = document.createElement('div');
                row.className = 'leading-5';
                row.innerText = `- ${msg}`;
                el.appendChild(row);
            });
        };

        const setCashToCloseBreakdown = (rows) => {
            const container = document.getElementById('cashToCloseBreakdown');
            if (!container) return;

            container.replaceChildren();
            rows.forEach((row) => {
                const rowClass = row.emphasis
                    ? 'flex items-center justify-between font-semibold text-gray-900 pt-2 mt-2 border-t border-gray-200'
                    : 'flex items-center justify-between text-gray-700';
                const rowEl = document.createElement('div');
                rowEl.className = rowClass;

                const labelEl = document.createElement('span');
                labelEl.innerText = String(row.label ?? '');
                const valueEl = document.createElement('span');
                valueEl.innerText = formatMoney(row.value);

                rowEl.appendChild(labelEl);
                rowEl.appendChild(valueEl);
                container.appendChild(rowEl);
            });
        };

        const formatBreakEven = (month) => {
            if (!month || month > 120) return 'No break-even in 10 years';
            const year = Math.ceil(month / 12);
            return `Month ${month} (Yr ${year})`;
        };

        const setLocationEstimateHint = (message, tone = 'info') => {
            const el = document.getElementById('locationEstimateHint');
            if (!el) return;
            el.innerText = message;

            if (tone === 'success') {
                el.className = 'text-xs text-emerald-800 leading-5';
            } else if (tone === 'warn') {
                el.className = 'text-xs text-amber-800 leading-5';
            } else {
                el.className = 'text-xs text-indigo-800 leading-5';
            }
        };

        const setLiveRateHint = (message, tone = 'info') => {
            const el = document.getElementById('liveRateHint');
            if (!el) return;
            el.innerText = message;

            if (tone === 'success') {
                el.className = 'text-xs text-emerald-700 leading-5';
            } else if (tone === 'warn') {
                el.className = 'text-xs text-amber-700 leading-5';
            } else {
                el.className = 'text-xs text-gray-500 leading-5';
            }
        };

        const getListingSourceLabel = (source) => {
            const meta = LOCATION_QUALITY_META[source] ?? LOCATION_QUALITY_META.listing;
            return meta.label;
        };
        const getListingDataSourceLabel = (source) => ({
            'redfin.com': 'matching Redfin public listing',
            'bing-search-snippet': 'search snippet result',
            'yahoo-search-snippet': 'search snippet result',
            'brave-search-snippet': 'search snippet result',
            'search-snippet': 'search snippet result',
            search: 'search snippet result'
        })[source] ?? getListingSourceLabel(source);

        const formatSourceUrl = (rawUrl) => {
            try {
                const parsed = new URL(rawUrl);
                const path = parsed.pathname.replace(/\/$/, '');
                const shortenedPath = path.length > 42 ? `${path.slice(0, 39)}...` : path;
                return `${parsed.hostname}${shortenedPath}`;
            } catch (error) {
                return String(rawUrl ?? '').trim();
            }
        };

        const fetchListingCostsFromUrl = async (listingUrl) => {
            const endpoint = `${LISTING_COSTS_ENDPOINT}?url=${encodeURIComponent(listingUrl)}`;
            return await fetchApiJsonWithTimeout(endpoint, 24000);
        };

        const setActiveLocationProfile = (profile) => {
            locationEstimateState.source = profile.source;
            locationEstimateState.sourceYear = profile.year ?? null;
            locationEstimateState.sourceName = profile.sourceName ?? '';
            locationEstimateState.sourceUrl = profile.sourceUrl ?? '';
            locationEstimateState.propertyFacts = profile.propertyFacts ?? null;
            locationEstimateState.taxInsight = profile.taxInsight ?? '';
            locationEstimateState.hoaInsight = profile.hoaInsight ?? '';
            locationEstimateState.fetchInsight = profile.fetchInsight ?? '';
            setLocationQualityBadge(profile.source, profile.year ?? null);
        };

        const buildLocationEstimateMessage = ({ listingProfile, pmiText }) => {
            const sourceLabel = getListingSourceLabel(listingProfile.source);
            const parts = [];
            if (listingProfile.priceInsight) parts.push(listingProfile.priceInsight);
            if (listingProfile.taxInsight) parts.push(listingProfile.taxInsight);
            if (listingProfile.hoaInsight) parts.push(listingProfile.hoaInsight);
            if (pmiText) parts.push(pmiText);
            return parts.length
                ? `Applied ${sourceLabel}: ${parts.join(', ')}.`
                : `Applied ${sourceLabel}.`;
        };

        const formatListingFactNumber = (value, digits = 1) => {
            const amount = Number(value);
            if (!Number.isFinite(amount) || amount <= 0) return '';
            if (Number.isInteger(amount)) return amount.toLocaleString('en-US');
            return amount.toFixed(digits).replace(/\.0+$/, '');
        };

        const formatListingSquareFeet = (value) => {
            const amount = Number(value);
            if (!Number.isFinite(amount) || amount <= 0) return '';
            return Math.round(amount).toLocaleString('en-US');
        };

        const buildListingFactsText = (propertyFacts) => {
            const facts = propertyFacts ?? {};
            const parts = [];

            if (facts.beds?.found) {
                const bedsText = formatListingFactNumber(facts.beds.value, 1);
                if (bedsText) parts.push(`${bedsText} bd`);
            }
            if (facts.baths?.found) {
                const bathsText = formatListingFactNumber(facts.baths.value, 1);
                if (bathsText) parts.push(`${bathsText} ba`);
            }
            if (facts.squareFeet?.found) {
                const sqftText = formatListingSquareFeet(facts.squareFeet.value);
                if (sqftText) parts.push(`${sqftText} sq ft`);
            }
            if (facts.location?.found) {
                const locationText = String(facts.location.value ?? '').trim();
                if (locationText) parts.push(locationText);
            }

            return parts.length ? `Listing details: ${parts.join(' • ')}.` : 'Listing details unavailable.';
        };

        const updateEscrowBreakdownVisualization = ({ taxMonthly = 0, insuranceMonthly = 0, hoaMonthly = 0 }) => {
            const tax = Math.max(0, Number(taxMonthly) || 0);
            const insurance = Math.max(0, Number(insuranceMonthly) || 0);
            const hoa = Math.max(0, Number(hoaMonthly) || 0);
            const total = tax + insurance + hoa;
            const escrowed = tax + insurance;
            const taxYear = locationEstimateState.sourceYear ? String(locationEstimateState.sourceYear) : '';

            const setWidth = (id, value) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.style.width = total > 0 ? `${(Math.max(0, value) / total) * 100}%` : '0%';
            };

            const setValue = (id, value, share) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.innerText = `${formatMoney(value)}/mo${share > 0 ? ` (${share.toFixed(1)}%)` : ''}`;
            };

            setWidth('escrowTaxSegment', tax);
            setWidth('escrowInsuranceSegment', insurance);
            setWidth('escrowHoaSegment', hoa);

            setElText('escrowMonthlyTotal', `Escrowed monthly ${formatMoney(escrowed)}/mo`);
            setElText('escrowTaxLabel', taxYear ? `Property tax ${taxYear}` : 'Property tax');
            setValue('escrowTaxValue', tax, total > 0 ? (tax / total) * 100 : 0);
            setElText('escrowInsuranceLabel', 'Homeowners insurance');
            setValue('escrowInsuranceValue', insurance, total > 0 ? (insurance / total) * 100 : 0);
            setElText('escrowHoaLabel', 'HOA outside escrow');
            setValue('escrowHoaValue', hoa, total > 0 ? (hoa / total) * 100 : 0);
        };

        async function applyLocationEstimateFromInputs() {
            const listingUrlEl = document.getElementById('propertyListingUrl');
            const rawListingUrl = listingUrlEl?.value?.trim() ?? '';
            if (!rawListingUrl) {
                setLocationEstimateHint('Paste a Realtor listing URL, then apply listing data.', 'warn');
                return false;
            }

            const listingSource = getListingSourceFromUrl(rawListingUrl);
            if (!listingSource) {
                setLocationEstimateHint('Use a supported Realtor listing URL.', 'warn');
                return false;
            }

            const loanType = getSelectVal('loanType', 'conventional');

            setLocationEstimateHint(`Fetching ${getListingSourceLabel(listingSource.source)} data...`, 'info');

            let payload;
            try {
                payload = await fetchListingCostsFromUrl(listingSource.url);
            } catch (error) {
                setLocationEstimateHint('Listing data fetch was blocked or unavailable. Run `npm run dev` to start the local API server, then retry.', 'warn');
                return false;
            }

            const tax = payload?.tax && Number.isFinite(Number(payload.tax.amountAnnual))
                ? payload.tax
                : null;
            const hoa = payload?.hoa && Number.isFinite(Number(payload.hoa.amountMonthly))
                ? payload.hoa
                : { amountMonthly: 0, found: false };
            const hoaMonthly = Math.max(0, Number(hoa.amountMonthly) || 0);
            const listingHomePrice = payload?.homePrice?.found
                ? Number(payload.homePrice.amount)
                : 0;

            if (listingHomePrice > RATE_EPSILON) {
                setCurrencyInput('homePrice', listingHomePrice);
                syncDownPaymentFromPercent();
                syncMortgageInsuranceRateFromLoanInputs();
            }

            const homePrice = getVal('homePrice');
            const downPayment = getVal('downPayment');
            const annualPmiRate = homePrice > RATE_EPSILON
                ? estimateAnnualMortgageInsuranceRate({ loanType, homePrice, downPayment })
                : 0;
            const effectiveDown = clamp(downPayment, 0, homePrice);
            const ltv = homePrice > RATE_EPSILON
                ? (Math.max(0, homePrice - effectiveDown) / homePrice)
                : 0;
            const pmiText = homePrice > RATE_EPSILON
                ? (loanType === 'va' || (loanType === 'conventional' && ltv <= 0.80 + RATE_EPSILON)
                    ? 'PMI 0%'
                    : `${loanType === 'fha' ? 'MIP' : 'PMI'} ${formatPercent(annualPmiRate)}`)
                : '';

            if (tax && Number(tax.amountAnnual) > 0) setCurrencyInput('propertyTax', Number(tax.amountAnnual));
            setCurrencyInput('hoaFee', hoaMonthly);

            if (listingUrlEl && payload?.url) listingUrlEl.value = payload.url;

            const currentYear = Number(tax?.currentYear) || new Date().getFullYear();
            const priceInsight = homePrice > RATE_EPSILON
                ? `home price ${formatWholeMoney(homePrice)}`
                : '';
            const taxInsight = tax && Number(tax.amountAnnual) > 0
                ? `property tax from ${tax.year ?? currentYear}: ${formatWholeMoney(Number(tax.amountAnnual))}/yr`
                : 'property tax unchanged';
            const hoaInsight = hoa?.found
                ? `HOA ${formatWholeMoney(hoaMonthly)}/mo`
                : 'HOA $0/mo';
            const fetchInsight = payload?.warning === 'used-search-snippet-match' || payload?.warning === 'used-public-listing-match'
                ? `Direct ${getListingSourceLabel(listingSource.source)} fetch was unavailable, so the lookup used a ${getListingDataSourceLabel(payload?.dataSource)}.`
                : '';
            const listingProfile = {
                source: payload?.source || listingSource.source,
                sourceName: getListingSourceLabel(payload?.source || listingSource.source),
                sourceUrl: payload?.url || listingSource.url,
                propertyFacts: payload?.propertyFacts ?? null,
                priceInsight,
                year: tax?.year ?? currentYear,
                taxInsight,
                hoaInsight,
                fetchInsight
            };

            setActiveLocationProfile(listingProfile);
            const message = buildLocationEstimateMessage({ listingProfile, pmiText });
            const tone = tax?.isCurrentYear && hoa?.found ? 'success' : 'warn';
            setLocationEstimateHint(message, tone);
            return true;
        }

        const buildLoanCostProfile = ({ homePrice, downPayment, loanType }) => {
            const effectiveDownPayment = clamp(downPayment, 0, homePrice);
            const baseLoan = Math.max(0, homePrice - effectiveDownPayment);

            const includePoints = getChecked('includePointsToggle');
            const includeLenderFees = getChecked('includeLenderFeesToggle');
            const includeOtherCosts = getChecked('includeOtherCostsToggle');
            const includePrepaids = getChecked('includePrepaidsToggle');

            const discountPointsPct = getVal('discountPoints') / 100;
            const pointsAmount = includePoints ? (baseLoan * discountPointsPct) : 0;
            const financePoints = getChecked('financePointsToggle');
            const financedPoints = financePoints ? pointsAmount : 0;
            const upfrontPoints = financePoints ? 0 : pointsAmount;

            const lenderFees = includeLenderFees ? getVal('lenderFees') : 0;
            const otherClosingCosts = includeOtherCosts ? getVal('otherClosingCosts') : 0;
            const totalOtherCosts = lenderFees + otherClosingCosts;
            const financeCosts = getChecked('financeCostsToggle');
            const financedOtherCosts = financeCosts ? totalOtherCosts : 0;
            const upfrontOtherCosts = financeCosts ? 0 : totalOtherCosts;

            const prepaidItems = includePrepaids ? getVal('prepaidItems') : 0;

            const vaFeeExempt = getChecked('vaFeeExempt');
            let govtFeeRate = 0;
            if (loanType === 'fha') govtFeeRate = 0.0175;
            if (loanType === 'va' && !vaFeeExempt) govtFeeRate = 0.0215;
            const govtFeeAmount = baseLoan * govtFeeRate;
            const govtFeeMode = getSelectVal('govtFeeMode', 'financed');
            const financedGovtFee = govtFeeMode === 'financed' ? govtFeeAmount : 0;
            const upfrontGovtFee = govtFeeMode === 'upfront' ? govtFeeAmount : 0;

            const noteLoanAmount = baseLoan + financedGovtFee + financedPoints + financedOtherCosts;
            const upfrontFinanceCharges = upfrontGovtFee + upfrontPoints + upfrontOtherCosts;
            const amountFinancedApr = Math.max(1, baseLoan - upfrontFinanceCharges);
            const upfrontCashToClose = effectiveDownPayment + upfrontGovtFee + upfrontPoints + upfrontOtherCosts + prepaidItems;

            return {
                loanType,
                effectiveDownPayment,
                baseLoan,
                noteLoanAmount,
                govtFeeAmount,
                financedGovtFee,
                upfrontGovtFee,
                pointsAmount,
                financedPoints,
                upfrontPoints,
                lenderFees,
                otherClosingCosts,
                totalOtherCosts,
                financedOtherCosts,
                upfrontOtherCosts,
                prepaidItems,
                amountFinancedApr,
                upfrontCashToClose,
                upfrontFinanceCharges
            };
        };

        const runRentVsBuyScenario = (params) => {
            const downPayment = params.price * params.downPct;
            const loanProfile = buildLoanCostProfile({
                homePrice: params.price,
                downPayment,
                loanType: params.loanType
            });

            const originationLtv = params.price > 0 ? (loanProfile.baseLoan / params.price) : 1;
            const monthlyRate = params.annualRate / 12;
            const monthlyPI = computeMonthlyPayment(loanProfile.noteLoanAmount, monthlyRate, params.termMonths);
            const monthlyAppreciationFactor = Math.pow(1 + params.appreciation, 1 / 12);
            const monthlyRentGrowthFactor = Math.pow(1 + params.rentInflation, 1 / 12);
            const safeOpportunityAnnual = clamp(params.opportunityAnnualReturn, -0.99, 1);
            const monthlyInvestmentReturn = Math.pow(1 + safeOpportunityAnnual, 1 / 12) - 1;

            let balance = loanProfile.noteLoanAmount;
            let homeValue = params.price;
            let currentMonthlyRent = params.monthlyRentStart;
            let cumulativeRent = 0;
            let cumulativeBuyCashOut = loanProfile.upfrontCashToClose + (params.price * params.buyClosingRate);
            let investmentBalance = cumulativeBuyCashOut;
            let breakEvenMonth = null;

            let annualInterest = 0;
            let annualPropertyTax = 0;

            const rentData = [];
            const buyData = [];

            for (let month = 1; month <= 120; month += 1) {
                const rentOutflow = currentMonthlyRent;
                cumulativeRent += rentOutflow;

                const balanceBeforePayment = balance;
                const interest = monthlyRate > RATE_EPSILON ? (balance * monthlyRate) : 0;
                const principal = Math.min(balance, Math.max(0, monthlyPI - interest));
                balance = Math.max(0, balance - principal);

                const monthlyMortgageInsurance = computeMortgageInsuranceForPeriod({
                    loanType: params.loanType,
                    balanceBeforePayment,
                    balanceAfterPayment: balance,
                    homePrice: params.price,
                    annualPmiRate: params.annualPmiRate,
                    periodIndex: month,
                    periodsPerYear: 12,
                    originationLtv,
                    convPmiDropLtv: params.convPmiDropLtv
                });

                const monthlyTax = (homeValue * params.taxRate) / 12;
                const monthlyInsurance = (homeValue * params.insuranceRate) / 12;
                const monthlyMaintenance = (homeValue * params.maintenanceRate) / 12;

                const buyOutflow = interest + principal + monthlyMortgageInsurance + monthlyTax + monthlyInsurance + params.hoaMonthly + monthlyMaintenance;
                cumulativeBuyCashOut += buyOutflow;

                annualInterest += interest;
                annualPropertyTax += monthlyTax;

                let taxBenefitThisMonth = 0;
                if (month % 12 === 0) {
                    if (params.taxTreatment === 'interest') {
                        taxBenefitThisMonth = annualInterest * params.marginalTaxRate;
                    } else if (params.taxTreatment === 'itemized') {
                        const itemizedDeduction = annualInterest + Math.min(SALT_CAP_ANNUAL, annualPropertyTax);
                        taxBenefitThisMonth = Math.max(0, itemizedDeduction - params.standardDeduction) * params.marginalTaxRate;
                    }
                    cumulativeBuyCashOut -= taxBenefitThisMonth;
                    annualInterest = 0;
                    annualPropertyTax = 0;
                }

                const relativeMonthlySavings = buyOutflow - rentOutflow - taxBenefitThisMonth;
                investmentBalance = (investmentBalance + relativeMonthlySavings) * (1 + monthlyInvestmentReturn);

                homeValue *= monthlyAppreciationFactor;
                currentMonthlyRent *= monthlyRentGrowthFactor;

                const saleProceedsAfterCosts = homeValue * (1 - params.saleCostRate);
                const equityAtSale = saleProceedsAfterCosts - balance;
                const netBuyCost = cumulativeBuyCashOut - equityAtSale;
                const netRentCost = cumulativeRent - investmentBalance;

                if (breakEvenMonth === null && netBuyCost <= netRentCost) breakEvenMonth = month;
                if (month % 12 === 0) {
                    rentData.push(netRentCost);
                    buyData.push(netBuyCost);
                }
            }

            return {
                rentData,
                buyData,
                breakEvenMonth,
                finalRentCost: rentData[rentData.length - 1] ?? 0,
                finalBuyCost: buyData[buyData.length - 1] ?? 0
            };
        };

        // --- GLOBAL STATE ---
        let breakdownChart = null;
        let breakdownPopupChart = null;
        let affordChart = null;
        let rentBuyChart = null;
        let refiChart = null;
        let isSyncingDownPayment = false;
        let latestPaymentBreakdownRows = [];
        let latestMortgageSchedule = null;

        const BREAKDOWN_COLOR_BY_LABEL = {
            'P&I': '#4f46e5',
            Tax: '#3b82f6',
            Insurance: '#0ea5e9',
            HOA: '#6366f1',
            'PMI/MIP': '#f59e0b'
        };

        const getBreakdownColor = (label) => BREAKDOWN_COLOR_BY_LABEL[label] || '#9ca3af';
        const getVisibleBreakdownRows = () => latestPaymentBreakdownRows.filter((row) => row.value > 0);
        const getBreakdownChartPayload = () => {
            const rows = getVisibleBreakdownRows();
            return {
                labels: rows.map((row) => row.label),
                data: rows.map((row) => row.value),
                colors: rows.map((row) => getBreakdownColor(row.label))
            };
        };

        const isPopupOpen = (popupId) => {
            const el = document.getElementById(popupId);
            return Boolean(el && !el.classList.contains('hidden'));
        };

        const syncModalBodyLock = () => {
            const anyOpen = isPopupOpen('breakdownPopup') || isPopupOpen('amortizationPopup');
            document.body.classList.toggle('overflow-hidden', anyOpen);
        };

        const openPopup = (popupId) => {
            const popupEl = document.getElementById(popupId);
            if (!popupEl) return;
            popupEl.classList.remove('hidden');
            popupEl.classList.add('flex');
            popupEl.setAttribute('aria-hidden', 'false');
            syncModalBodyLock();
        };

        const closePopup = (popupId) => {
            const popupEl = document.getElementById(popupId);
            if (!popupEl) return;
            popupEl.classList.add('hidden');
            popupEl.classList.remove('flex');
            popupEl.setAttribute('aria-hidden', 'true');
            if (popupId === 'breakdownPopup' && breakdownPopupChart) {
                breakdownPopupChart.destroy();
                breakdownPopupChart = null;
            }
            syncModalBodyLock();
        };

        const closeAllPopups = () => {
            closePopup('breakdownPopup');
            closePopup('amortizationPopup');
        };

        const renderBreakdownPopupContent = () => {
            const detailsEl = document.getElementById('breakdownPopupDetails');
            const loanDetailsEl = document.getElementById('breakdownPopupLoanDetails');
            const chartCanvas = document.getElementById('breakdownPopupChart');
            if (!detailsEl || !loanDetailsEl || !chartCanvas) return;

            const rows = getVisibleBreakdownRows();

            const rowsByLabel = new Map(rows.map((row) => [row.label, row]));
            const totalMonthly = rows.reduce((sum, row) => sum + Math.max(0, Number(row.value) || 0), 0);
            const homePrice = getVal('homePrice');
            const downPayment = getVal('downPayment');
            const loanAmount = Math.max(0, homePrice - downPayment);
            const interestRate = getVal('interestRate') / 100;
            const loanTermYears = getSelectVal('loanTerm', '30');
            const taxYear = locationEstimateState.sourceYear ? String(locationEstimateState.sourceYear) : 'Not applied';
            const pmiRow = rowsByLabel.get('PMI/MIP');

            loanDetailsEl.replaceChildren();
            [
                { label: 'Home Price', value: homePrice > 0 ? formatMoney(homePrice) : 'N/A' },
                { label: 'Down Payment', value: homePrice > 0 ? formatMoney(downPayment) : 'N/A' },
                { label: 'Base Loan', value: loanAmount > 0 ? formatMoney(loanAmount) : 'N/A' },
                { label: 'Interest Rate', value: formatPercent(interestRate) },
                { label: 'Loan Term', value: `${loanTermYears} years` },
                { label: 'Tax Year', value: taxYear },
                { label: 'P&I', value: rowsByLabel.get('P&I') ? formatMoney(rowsByLabel.get('P&I').value) : formatMoney(0) },
                ...(pmiRow ? [{ label: 'PMI/MIP', value: formatMoney(pmiRow.value) }] : []),
                { label: 'Monthly Total', value: formatMoney(totalMonthly) }
            ].forEach((item) => {
                const line = document.createElement('div');
                line.className = 'flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2';

                const label = document.createElement('div');
                label.className = 'font-medium text-gray-700';
                label.innerText = String(item.label ?? '');

                const value = document.createElement('div');
                value.className = 'font-semibold text-gray-900 text-right';
                value.innerText = String(item.value ?? '');

                line.appendChild(label);
                line.appendChild(value);
                loanDetailsEl.appendChild(line);
            });

            detailsEl.replaceChildren();
            if (!rows.length) {
                const empty = document.createElement('p');
                empty.className = 'text-sm text-gray-500';
                empty.innerText = 'No payment components available.';
                detailsEl.appendChild(empty);
                if (breakdownPopupChart) {
                    breakdownPopupChart.destroy();
                    breakdownPopupChart = null;
                }
                return;
            }

            const total = rows.reduce((sum, row) => sum + row.value, 0);
            rows.forEach((row) => {
                const share = total > 0 ? ((row.value / total) * 100) : 0;
                const line = document.createElement('div');
                line.className = 'flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2';

                const label = document.createElement('div');
                label.className = 'font-medium text-gray-700';
                label.innerText = String(row.label ?? '');

                const valueWrap = document.createElement('div');
                valueWrap.className = 'font-semibold text-gray-900';
                valueWrap.innerText = `${formatMoney(row.value)} `;
                const pct = document.createElement('span');
                pct.className = 'text-xs font-medium text-gray-500';
                pct.innerText = `(${share.toFixed(1)}%)`;
                valueWrap.appendChild(pct);

                line.appendChild(label);
                line.appendChild(valueWrap);
                detailsEl.appendChild(line);
            });

            if (typeof Chart === 'undefined') return;
            const payload = getBreakdownChartPayload();
            breakdownPopupChart = syncChartInstance(breakdownPopupChart, chartCanvas, {
                type: 'doughnut',
                data: {
                    labels: payload.labels,
                    datasets: [{ data: payload.data, backgroundColor: payload.colors }]
                },
                options: {
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        };

        const renderAmortizationPopupTable = () => {
            const bodyEl = document.getElementById('amortizationPopupBody');
            if (!bodyEl) return;
            if (!latestMortgageSchedule || !Array.isArray(latestMortgageSchedule.periodRows) || !latestMortgageSchedule.periodRows.length) {
                bodyEl.replaceChildren();
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.className = 'px-6 py-3 text-sm text-gray-500';
                td.colSpan = 8;
                td.innerText = 'No schedule available.';
                tr.appendChild(td);
                bodyEl.appendChild(tr);
                return;
            }

            bodyEl.replaceChildren();
            latestMortgageSchedule.periodRows.forEach((row) => {
                const monthDisplay = Number.isInteger(row.monthApprox) ? row.monthApprox.toString() : row.monthApprox.toFixed(1);
                const tr = document.createElement('tr');
                [
                    `P${row.period}`,
                    `Mo ${monthDisplay}`,
                    `Yr ${row.year}`,
                    formatMoney(row.interest),
                    formatMoney(row.principal),
                    formatMoney(row.pmi),
                    formatMoney(row.payment),
                    formatMoney(row.balance)
                ].forEach((value) => {
                    const td = document.createElement('td');
                    td.className = 'px-6 py-2';
                    td.innerText = value;
                    tr.appendChild(td);
                });
                bodyEl.appendChild(tr);
            });
        };

        const openBreakdownPopup = () => {
            openPopup('breakdownPopup');
            renderBreakdownPopupContent();
        };

        const openAmortizationPopup = () => {
            openPopup('amortizationPopup');
            renderAmortizationPopupTable();
        };

        const setElText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.innerText = text;
        };

        const toMonthStamp = (period, periodsPerYear) => {
            if (!Number.isFinite(period) || !Number.isFinite(periodsPerYear) || periodsPerYear <= 0) return 'N/A';
            const months = period * (12 / periodsPerYear);
            const roundedMonths = Math.max(0, Math.round(months));
            const yearApprox = roundedMonths / 12;
            const targetDate = new Date();
            targetDate.setMonth(targetDate.getMonth() + roundedMonths);
            const calendar = targetDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            return `Mo ${roundedMonths} (${calendar}, ~Yr ${yearApprox.toFixed(1)})`;
        };

        const findFirstPeriodAtOrBelowLtv = (periodRows, homePrice, ltvThreshold) => {
            if (!Array.isArray(periodRows) || !periodRows.length || homePrice <= 0) return null;
            return periodRows.find((row) => (row.balance / homePrice) <= ltvThreshold) ?? null;
        };

        const findMiEndPeriod = (periodRows) => {
            if (!Array.isArray(periodRows) || !periodRows.length) return { endRow: null, lastMiRow: null, hadMi: false };
            const firstMiIdx = periodRows.findIndex((row) => row.pmi > RATE_EPSILON);
            if (firstMiIdx < 0) return { endRow: null, lastMiRow: null, hadMi: false };
            for (let i = firstMiIdx + 1; i < periodRows.length; i += 1) {
                if (periodRows[i].pmi <= RATE_EPSILON) {
                    return { endRow: periodRows[i], lastMiRow: periodRows[i - 1], hadMi: true };
                }
            }
            return { endRow: null, lastMiRow: periodRows[periodRows.length - 1], hadMi: true };
        };

        const MILESTONE_SNAPSHOT_YEARS = [1, 5, 10, 15, 20, 25, 30];

        const summarizeScheduleAtYears = ({ periodRows, periodsPerYear, years, startingBalance }) => {
            const targetPeriods = Math.max(0, Math.round(years * periodsPerYear));
            const cappedPeriods = Math.min(periodRows.length, targetPeriods);
            const selectedRows = periodRows.slice(0, cappedPeriods);
            const milestoneYearStart = Math.max(0, cappedPeriods - periodsPerYear);
            const milestoneYearRows = periodRows.slice(milestoneYearStart, cappedPeriods);
            if (!selectedRows.length) {
                return {
                    totalPaid: 0,
                    principalPaid: 0,
                    interestPaid: 0,
                    miPaid: 0,
                    balance: startingBalance
                };
            }

            return {
                totalPaid: selectedRows.reduce((sum, row) => sum + row.payment, 0),
                principalPaid: selectedRows.reduce((sum, row) => sum + row.principal, 0),
                interestPaid: selectedRows.reduce((sum, row) => sum + row.interest, 0),
                miPaid: milestoneYearRows.reduce((sum, row) => sum + row.pmi, 0),
                balance: selectedRows[selectedRows.length - 1].balance
            };
        };

        const renderMilestoneSnapshotTable = ({ periodRows, periodsPerYear, termMonths, startingBalance, payoffPeriod }) => {
            const bodyEl = document.getElementById('milestoneSnapshotBody');
            const noteEl = document.getElementById('milestoneSnapshotNote');
            if (!bodyEl) return;

            bodyEl.replaceChildren();
            MILESTONE_SNAPSHOT_YEARS.forEach((years) => {
                const summary = summarizeScheduleAtYears({
                    periodRows,
                    periodsPerYear,
                    years,
                    startingBalance
                });
                const tr = document.createElement('tr');
                [
                    `Yr ${years}`,
                    formatMoney(summary.totalPaid),
                    formatMoney(summary.principalPaid),
                    formatMoney(summary.interestPaid),
                    formatMoney(summary.miPaid),
                    formatMoney(summary.balance)
                ].forEach((value, idx) => {
                    const td = document.createElement('td');
                    td.className = idx === 0
                        ? 'px-4 py-2 font-medium text-gray-900'
                        : 'px-4 py-2 text-gray-700';
                    td.innerText = value;
                    tr.appendChild(td);
                });
                bodyEl.appendChild(tr);
            });

            if (!noteEl) return;
            const selectedTermYears = termMonths / 12;
            const maxMilestoneYear = MILESTONE_SNAPSHOT_YEARS[MILESTONE_SNAPSHOT_YEARS.length - 1];
            if (selectedTermYears < maxMilestoneYear) {
                noteEl.innerText = `Selected loan term is ${selectedTermYears} years. Milestones beyond the payoff horizon show final payoff totals.`;
                return;
            }
            if (Number.isFinite(payoffPeriod) && payoffPeriod > 0 && payoffPeriod < (maxMilestoneYear * periodsPerYear)) {
                noteEl.innerText = `Loan pays off around ${toMonthStamp(payoffPeriod, periodsPerYear)}. Later milestones show final payoff totals.`;
                return;
            }
            noteEl.innerText = 'Milestones are based on scheduled payments under current assumptions.';
        };

        const renderMortgageInsights = ({
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
        }) => {
            if (!schedule || !loanProfile) return;

            const periodRows = Array.isArray(schedule.periodRows) ? schedule.periodRows : [];
            const periodsPerYear = schedule.periodsPerYear || 12;

            const { endRow: miEndRow, lastMiRow, hadMi } = findMiEndPeriod(periodRows);
            const paymentAfterMi = requiredMortgageMonthly + taxMonthly + insuranceMonthly + hoaMonthly;
            const finalMiMonthly = lastMiRow ? (lastMiRow.pmi * (periodsPerYear / 12)) : 0;
            const miSavingsMonthly = hadMi ? finalMiMonthly : 0;

            setElText('phasePaymentNow', formatMoney(totalMonthly));
            setElText('phasePaymentAfterMi', formatMoney(paymentAfterMi));
            if (!hadMi) {
                setElText('phasePaymentAfterMiWhen', 'No monthly MI applied');
            } else if (miEndRow) {
                setElText('phasePaymentAfterMiWhen', toMonthStamp(miEndRow.period, periodsPerYear));
            } else {
                setElText('phasePaymentAfterMiWhen', 'No projected end in current term');
            }
            setElText('phasePaymentArmReset', 'N/A');

            const stressRateAnnual = Math.max(0, annualRate + 0.01);
            const stressRatePiMonthly = computeMonthlyPayment(loanProfile.noteLoanAmount, stressRateAnnual / 12, termMonths);
            const stressRateTotal = stressRatePiMonthly + firstPeriodPmiMonthly + taxMonthly + insuranceMonthly + hoaMonthly;
            const stressInsTotal = requiredMortgageMonthly + firstPeriodPmiMonthly + taxMonthly + (insuranceMonthly * 1.20) + hoaMonthly;
            const stressTaxTotal = requiredMortgageMonthly + firstPeriodPmiMonthly + (taxMonthly * 1.15) + insuranceMonthly + hoaMonthly;
            const worstCaseMonthly = Math.max(totalMonthly, stressRateTotal, stressInsTotal, stressTaxTotal);
            setElText('phasePaymentWorst', formatMoney(worstCaseMonthly));

            renderMilestoneSnapshotTable({
                periodRows,
                periodsPerYear,
                termMonths,
                startingBalance: loanProfile.noteLoanAmount,
                payoffPeriod: periodRows.length ? periodRows[periodRows.length - 1].period : 0
            });

            const sellerCredits = 0;
            const lenderCredits = 0;
            const borrowerPaidAtClose = loanProfile.upfrontCashToClose;
            const borrowerPaidBeforeClose = 0;
            const netCashToClose = borrowerPaidAtClose + borrowerPaidBeforeClose - sellerCredits - lenderCredits;
            setElText('ccBorrowerAtClose', formatMoney(borrowerPaidAtClose));
            setElText('ccBorrowerBeforeClose', formatMoney(borrowerPaidBeforeClose));
            setElText('ccSellerCredits', formatMoney(sellerCredits));
            setElText('ccLenderCredits', formatMoney(lenderCredits));
            setElText('ccNetCashToClose', formatMoney(netCashToClose));

            if (loanType === 'va') {
                setElText('miProjectedEnd', 'No monthly MI on VA');
                setElText('miRequest80', 'N/A');
                setElText('miAuto78', 'N/A');
                setElText('miMonthlySavings', formatMoney(0));
                setElText('miOffRampNote', 'VA loans typically do not carry monthly PMI/MIP, but may include an upfront funding fee.');
            } else if (loanType === 'fha') {
                const fhaEndText = miEndRow ? toMonthStamp(miEndRow.period, periodsPerYear) : 'Likely life-of-loan under current assumptions';
                setElText('miProjectedEnd', fhaEndText);
                setElText('miRequest80', 'N/A (conventional rule)');
                setElText('miAuto78', 'N/A (conventional rule)');
                setElText('miMonthlySavings', formatMoney(miSavingsMonthly));
                setElText('miOffRampNote', 'FHA MIP duration depends on original LTV and program rules; refinance may be required to remove life-of-loan MIP.');
            } else {
                const request80Row = findFirstPeriodAtOrBelowLtv(periodRows, homePrice, 0.80);
                const auto78Row = findFirstPeriodAtOrBelowLtv(periodRows, homePrice, 0.78);
                setElText('miProjectedEnd', miEndRow ? toMonthStamp(miEndRow.period, periodsPerYear) : (hadMi ? 'No projected end in term' : 'No MI required'));
                setElText('miRequest80', request80Row ? toMonthStamp(request80Row.period, periodsPerYear) : 'Not reached');
                setElText('miAuto78', auto78Row ? toMonthStamp(auto78Row.period, periodsPerYear) : 'Not reached');
                setElText('miMonthlySavings', formatMoney(miSavingsMonthly));
                setElText('miOffRampNote', '80%/78% lines are modeled from scheduled balance and original value assumptions.');
            }

            updateEscrowBreakdownVisualization({ taxMonthly, insuranceMonthly, hoaMonthly });
            const taxYearText = locationEstimateState.sourceYear ? ` from ${locationEstimateState.sourceYear}` : '';
            setElText('escrowIncluded', `Included in estimate: Property tax${taxYearText} (${formatMoney(taxMonthly)}/mo) + homeowners insurance (${formatMoney(insuranceMonthly)}/mo).`);
            setElText('escrowExcluded', `HOA dues (${formatMoney(hoaMonthly)}/mo) are shown separately and usually are not escrowed.`);
            setElText('escrowAssumption', 'Assumes taxes and insurance are collected monthly in escrow. Confirm actual setup with your lender.');

            const totalOfPaymentsEstimate = schedule.totalPaid + loanProfile.upfrontFinanceCharges;
            const tip = loanProfile.noteLoanAmount > 0 ? (schedule.totalInterest / loanProfile.noteLoanAmount) : 0;
            setElText('loanTotalOfPayments', formatMoney(totalOfPaymentsEstimate));
            setElText('loanTip', formatPercent(tip, 2));

            renderAssumptionTransparency();

            setElText('stressRateUpPayment', formatMoney(stressRateTotal));
            setElText('stressRateUpDelta', `${formatSignedMoney(stressRateTotal - totalMonthly)} vs current`);
            setElText('stressInsuranceUpPayment', formatMoney(stressInsTotal));
            setElText('stressInsuranceUpDelta', `${formatSignedMoney(stressInsTotal - totalMonthly)} vs current`);
            setElText('stressTaxUpPayment', formatMoney(stressTaxTotal));
            setElText('stressTaxUpDelta', `${formatSignedMoney(stressTaxTotal - totalMonthly)} vs current`);

            const incomeMonthly = getVal('affordIncome') / 12;
            const debtsMonthly = getVal('affordDebts');
            const affordMode = getSelectVal('affordMode', 'simple');
            const backDti = affordMode === 'expert' ? clamp(getVal('affordBackDti') / 100, 0, 1) : 0.36;
            const maxHousingAtBackDti = Math.max(0, (incomeMonthly * backDti) - debtsMonthly);
            const stressResultEl = document.getElementById('stressAffordabilityResult');
            let stressSummaryText = 'Can still afford? Unknown (set income/debts)';

            if (!stressResultEl || incomeMonthly <= 0 || maxHousingAtBackDti <= 0) {
                if (stressResultEl) {
                    stressResultEl.innerText = stressSummaryText;
                    stressResultEl.className = 'text-xs font-semibold text-gray-700';
                }
            } else if (worstCaseMonthly <= maxHousingAtBackDti) {
                const headroom = maxHousingAtBackDti - worstCaseMonthly;
                stressSummaryText = `Can still afford? Yes (${formatMoney(headroom)} headroom)`;
                stressResultEl.innerText = stressSummaryText;
                stressResultEl.className = 'text-xs font-semibold text-emerald-700';
            } else {
                const shortfall = worstCaseMonthly - maxHousingAtBackDti;
                stressSummaryText = `Can still afford? No (${formatMoney(shortfall)} shortfall)`;
                stressResultEl.innerText = stressSummaryText;
                stressResultEl.className = 'text-xs font-semibold text-rose-700';
            }

            renderDecisionSummary({ stressSummaryText });
        };

        const updateModeVisibility = () => {
            const affordMode = getSelectVal('affordMode', 'simple');
            const rbMode = getSelectVal('rbMode', 'simple');
            document.body.classList.toggle('afford-simple', affordMode === 'simple');
            document.body.classList.toggle('rb-simple', rbMode === 'simple');
        };

        const getConventionalPmiThresholdPct = () => {
            const rule = getSelectVal('convPmiRule', 'strict78');
            if (rule === 'strict78') return 78;
            if (rule === 'request80') return 80;
            return clamp(getVal('convPmiDropLtv') || 78, 50, 95);
        };

        const updateConventionalPmiControls = () => {
            const rule = getSelectVal('convPmiRule', 'strict78');
            const customWrap = document.getElementById('convPmiCustomWrap');
            const customInput = document.getElementById('convPmiDropLtv');
            if (!customWrap || !customInput) return;

            if (rule === 'strict78') {
                setNumberInput('convPmiDropLtv', 78, 0);
                customWrap.classList.add('hidden');
                customInput.disabled = true;
                return;
            }

            if (rule === 'request80') {
                setNumberInput('convPmiDropLtv', 80, 0);
                customWrap.classList.add('hidden');
                customInput.disabled = true;
                return;
            }

            customWrap.classList.remove('hidden');
            customInput.disabled = false;
        };

        const syncDownPaymentFromPercent = () => {
            if (isSyncingDownPayment) return;
            isSyncingDownPayment = true;
            const homePrice = getVal('homePrice');
            const percent = clamp(getVal('downPaymentPercent'), 0, 100);
            setCurrencyInput('downPayment', homePrice * (percent / 100));
            setNumberInput('loanToValue', 100 - percent, 2);
            isSyncingDownPayment = false;
        };

        const syncPercentFromDownPayment = () => {
            if (isSyncingDownPayment) return;
            isSyncingDownPayment = true;
            const homePrice = getVal('homePrice');
            const downPayment = getVal('downPayment');
            const pct = homePrice > 0 ? clamp((downPayment / homePrice) * 100, 0, 100) : 0;
            setNumberInput('downPaymentPercent', pct, 2);
            setNumberInput('loanToValue', 100 - pct, 2);
            isSyncingDownPayment = false;
        };

        const syncDownPaymentFromLoanToValue = () => {
            if (isSyncingDownPayment) return;
            isSyncingDownPayment = true;
            const homePrice = getVal('homePrice');
            const ltv = clamp(getVal('loanToValue'), 0, 100);
            const downPaymentPct = 100 - ltv;
            setNumberInput('downPaymentPercent', downPaymentPct, 2);
            setCurrencyInput('downPayment', homePrice * (downPaymentPct / 100));
            isSyncingDownPayment = false;
        };

        const syncMortgageInsuranceRateFromLoanInputs = () => {
            const homePrice = getVal('homePrice');
            const downPayment = getVal('downPayment');
            const loanType = getSelectVal('loanType', 'conventional');
            const annualPmiRate = homePrice > RATE_EPSILON
                ? estimateAnnualMortgageInsuranceRate({ loanType, homePrice, downPayment })
                : 0;
            setNumberInput('pmiRate', annualPmiRate * 100, 2);
        };

        const formatSignedMoney = (value) => `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;

        const getAssumptionSnapshot = () => {
            const sourceMeta = LOCATION_QUALITY_META[locationEstimateState.source] ?? LOCATION_QUALITY_META.unknown;
            const sourceName = locationEstimateState.sourceUrl
                ? formatSourceUrl(locationEstimateState.sourceUrl)
                : (locationEstimateState.sourceName || 'Manual/default values');
            const sourceYear = locationEstimateState.sourceYear ? String(locationEstimateState.sourceYear) : 'No tax year applied';
            const propertyFactsText = buildListingFactsText(locationEstimateState.propertyFacts);
            const taxInsight = locationEstimateState.taxInsight || 'Property tax can be entered or edited manually.';
            const hoaInsight = locationEstimateState.hoaInsight || 'HOA can be entered or edited manually.';
            return {
                sourceMeta,
                sourceName,
                sourceYear,
                propertyFactsText,
                taxInsight,
                hoaInsight
            };
        };

        const renderAssumptionTransparency = () => {
            const snapshot = getAssumptionSnapshot();
            const sourceText = `Source: ${snapshot.sourceMeta.label}. URL: ${snapshot.sourceName}.`;
            const yearText = `Tax year: ${snapshot.sourceYear}.`;
            const factsText = snapshot.propertyFactsText;
            const overrideText = `${snapshot.taxInsight} ${snapshot.hoaInsight}`;

            setElText('dataConfidenceLine', sourceText);
            setElText('dataFreshnessLine', yearText);
            setElText('dataPropertyFactsLine', factsText);
            setElText('dataManualOverrideLine', overrideText);

            setElText('affordAssumptionSource', sourceText);
            setElText('affordAssumptionYear', yearText);
            setElText('affordAssumptionOverride', overrideText);

            setElText('rentbuyAssumptionSource', sourceText);
            setElText('rentbuyAssumptionYear', yearText);
            setElText('rentbuyAssumptionOverride', overrideText);

            setElText('refiAssumptionSource', sourceText);
            setElText('refiAssumptionYear', yearText);
            setElText('refiAssumptionOverride', overrideText);
        };

        const computeDecisionSummaryBestOffer = () => {
            const price = getVal('rbPrice');
            const monthlyRentStart = getVal('rbRent');
            if (price <= 0 || monthlyRentStart <= 0) {
                return {
                    bestOffer: 'Need rent vs. buy inputs',
                    why: 'Set Rent vs. Buy price and rent to compute a best-offer recommendation.',
                    stress: ''
                };
            }

            const rbMode = getSelectVal('rbMode', 'simple');
            const isExpert = rbMode === 'expert';
            const referenceHomePrice = getVal('homePrice');
            const downPct = clamp((getVal('downPaymentPercent') / 100) || 0.20, 0, 0.95);
            const annualRate = (getVal('interestRate') / 100) || 0.065;
            const termMonths = (getVal('loanTerm') || 30) * 12;
            const annualPmiRate = getVal('pmiRate') / 100;
            const convPmiDropLtv = getConventionalPmiThresholdPct() / 100;
            const loanType = getSelectVal('loanType', 'conventional');
            const taxRate = referenceHomePrice > 0 ? (getVal('propertyTax') / referenceHomePrice) : 0.015;
            const insuranceRate = referenceHomePrice > 0 ? (getVal('homeInsurance') / referenceHomePrice) : 0.01;
            const baseParams = {
                price,
                monthlyRentStart,
                appreciation: getVal('rbApprec') / 100,
                rentInflation: getVal('rbRentInf') / 100,
                maintenanceRate: getVal('rbMaint') / 100,
                buyClosingRate: getVal('rbClosing') / 100,
                opportunityAnnualReturn: isExpert ? (getVal('rbInvestReturn') / 100) : 0,
                taxTreatment: isExpert ? getSelectVal('rbTaxTreatment', 'none') : 'none',
                marginalTaxRate: isExpert ? (getVal('rbMarginalTax') / 100) : 0,
                standardDeduction: isExpert ? getVal('rbStdDeduction') : 0,
                downPct,
                annualRate,
                termMonths,
                annualPmiRate,
                convPmiDropLtv,
                loanType,
                taxRate,
                insuranceRate,
                hoaMonthly: getVal('hoaFee'),
                saleCostRate: 0.06
            };

            const result = runRentVsBuyScenario(baseParams);
            const finalAdvantage = result.finalRentCost - result.finalBuyCost;
            const breakEvenText = formatBreakEven(result.breakEvenMonth);

            if (finalAdvantage > RATE_EPSILON) {
                return {
                    bestOffer: 'Buy now',
                    why: `Buying is ahead by ${formatMoney(finalAdvantage)} over 10 years. ${breakEvenText}.`
                };
            }
            if (finalAdvantage < -RATE_EPSILON) {
                return {
                    bestOffer: 'Rent for now',
                    why: `Renting is ahead by ${formatMoney(Math.abs(finalAdvantage))} over 10 years. ${breakEvenText}.`
                };
            }
            return {
                bestOffer: 'Near tie',
                why: `Renting and buying are effectively tied over 10 years. ${breakEvenText}.`
            };
        };

        const renderDecisionSummary = ({ stressSummaryText = '' } = {}) => {
            const decision = computeDecisionSummaryBestOffer();
            const assumptions = getAssumptionSnapshot();
            setElText('decisionBestOffer', decision.bestOffer);
            setElText('decisionWhy', decision.why);
            setElText('decisionStress', stressSummaryText ? `Stress-test result: ${stressSummaryText}` : 'Stress-test result: Unknown');
            setElText(
                'decisionAssumptions',
                `Assumptions: ${assumptions.sourceMeta.label}, year ${assumptions.sourceYear}. ${assumptions.taxLock}. ${assumptions.insuranceLock}.`
            );
        };

        const STAY_AFLOAT_PRESETS = {
            safe: { label: 'Safe', intent: 'Conservative cashflow guardrails', bufferPct: 0.30, targetDti: 0.30, reserveMonths: 6 },
            balanced: { label: 'Balanced', intent: 'Moderate flexibility with room for shocks', bufferPct: 0.20, targetDti: 0.35, reserveMonths: 4 },
            stretch: { label: 'Stretch', intent: 'Tighter cushion for higher leverage', bufferPct: 0.12, targetDti: 0.40, reserveMonths: 3 }
        };

        const updateStayAfloatEstimate = (housingProfile) => {
            const monthlyNeedEl = document.getElementById('afloatMonthlyNeed');
            const incomeNeedEl = document.getElementById('afloatIncomeNeed');
            const reserveNeedEl = document.getElementById('afloatReserveNeed');
            const gapNoteEl = document.getElementById('afloatGapNote');
            const presetHintEl = document.getElementById('afloatPresetHint');
            const policyNoteEl = document.getElementById('afloatPolicyNote');
            const stressTestsEl = document.getElementById('afloatStressTests');
            if (!monthlyNeedEl || !incomeNeedEl || !reserveNeedEl || !gapNoteEl || !presetHintEl || !policyNoteEl || !stressTestsEl) return;

            const safeHousing = Math.max(0, Number.isFinite(housingProfile?.housingMonthly)
                ? housingProfile.housingMonthly
                : (Number.isFinite(housingProfile) ? housingProfile : 0));
            const taxMonthly = Math.max(0, toFiniteNumber(housingProfile?.taxMonthly));
            const insuranceMonthly = Math.max(0, toFiniteNumber(housingProfile?.insuranceMonthly));
            const monthlyDebts = getVal('affordDebts');
            const essentialsMonthly = getVal('afloatEssentials');
            const annualIncome = getVal('affordIncome');
            const presetKey = getSelectVal('afloatPreset', 'safe');
            const preset = STAY_AFLOAT_PRESETS[presetKey] ?? STAY_AFLOAT_PRESETS.safe;
            const { label, intent, bufferPct, targetDti, reserveMonths } = preset;

            const baseObligations = safeHousing + monthlyDebts + essentialsMonthly;
            const comfortMonthlyNeed = baseObligations * (1 + bufferPct);
            const suggestedGrossMonthly = comfortMonthlyNeed / targetDti;
            const suggestedGrossAnnual = suggestedGrossMonthly * 12;
            const reserveTarget = baseObligations * reserveMonths;

            monthlyNeedEl.innerText = formatMoney(comfortMonthlyNeed);
            incomeNeedEl.innerText = formatMoney(suggestedGrossAnnual);
            reserveNeedEl.innerText = formatMoney(reserveTarget);
            presetHintEl.innerText = `${label}: ${intent}. ${(bufferPct * 100).toFixed(0)}% buffer, ${(targetDti * 100).toFixed(0)}% DTI target, ${reserveMonths} reserve months.`;
            policyNoteEl.innerText = `${STAY_AFLOAT_POLICY_VERSION}: preset thresholds are fixed for comparison over time.`;

            const calcComfortNeed = (housingMonthly) => (housingMonthly + monthlyDebts + essentialsMonthly) * (1 + bufferPct);
            const insuranceStressNeed = calcComfortNeed(safeHousing + (insuranceMonthly * 0.10));
            const taxStressNeed = calcComfortNeed(safeHousing + (taxMonthly * 0.15));
            const emergencyShock = essentialsMonthly;
            const emergencyMonthOutflow = baseObligations + emergencyShock;
            stressTestsEl.replaceChildren();
            [
                {
                    label: '+10% insurance',
                    value: `${formatMoney(insuranceStressNeed)} (${formatSignedMoney(insuranceStressNeed - comfortMonthlyNeed)})`
                },
                {
                    label: '+15% taxes',
                    value: `${formatMoney(taxStressNeed)} (${formatSignedMoney(taxStressNeed - comfortMonthlyNeed)})`
                },
                {
                    label: '+1 month emergency expense',
                    value: `One-time ${formatMoney(emergencyShock)} (month total ${formatMoney(emergencyMonthOutflow)})`
                }
            ].forEach((item) => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between';
                const left = document.createElement('span');
                left.className = 'text-gray-600';
                left.innerText = item.label;
                const right = document.createElement('span');
                right.className = 'font-semibold text-gray-900';
                right.innerText = item.value;
                row.appendChild(left);
                row.appendChild(right);
                stressTestsEl.appendChild(row);
            });

            const gatingNotes = [];
            if (essentialsMonthly <= 0) gatingNotes.push('Enter Essential Non-Housing (Mo) to complete the Stay Afloat profile.');
            if (annualIncome <= 0) gatingNotes.push('Add annual income in Affordability to compare against this target.');
            if (gatingNotes.length) {
                gapNoteEl.innerText = gatingNotes.join(' ');
                return;
            }

            const annualGap = suggestedGrossAnnual - annualIncome;
            gapNoteEl.innerText = annualGap > 0
                ? `Current annual income is ${formatMoney(annualGap)} below this comfort target.`
                : `Current annual income is ${formatMoney(Math.abs(annualGap))} above this comfort target.`;
        };

        const mortgageUiState = {
            get breakdownChart() { return breakdownChart; },
            set breakdownChart(value) { breakdownChart = value; },
            get latestPaymentBreakdownRows() { return latestPaymentBreakdownRows; },
            set latestPaymentBreakdownRows(value) { latestPaymentBreakdownRows = value; },
            get latestMortgageSchedule() { return latestMortgageSchedule; },
            set latestMortgageSchedule(value) { latestMortgageSchedule = value; }
        };
        const affordUiState = {
            get affordChart() { return affordChart; },
            set affordChart(value) { affordChart = value; }
        };
        const rentBuyUiState = {
            get rentBuyChart() { return rentBuyChart; },
            set rentBuyChart(value) { rentBuyChart = value; }
        };
        const refiUiState = {
            get refiChart() { return refiChart; },
            set refiChart(value) { refiChart = value; }
        };

        const mortgageCalculator = createMortgageCalculator({
            state: mortgageUiState,
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
            renderWarnings,
            syncChart: syncChartInstance
        });
        const affordabilityCalculator = createAffordabilityCalculator({
            state: affordUiState,
            getVal,
            getSelectVal,
            clamp,
            formatMoney,
            formatPercent,
            renderWarnings,
            updateModeVisibility,
            syncChart: syncChartInstance
        });
        const rentBuyCalculator = createRentBuyCalculator({
            state: rentBuyUiState,
            getVal,
            getSelectVal,
            clamp,
            formatMoney,
            formatPercent,
            formatBreakEven,
            renderWarnings,
            updateModeVisibility,
            syncChart: syncChartInstance,
            getConventionalPmiThresholdPct,
            runRentVsBuyScenario
        });
        const refinanceCalculator = createRefinanceCalculator({
            state: refiUiState,
            getVal,
            formatMoney,
            syncChart: syncChartInstance
        });

        // --- CALCULATION LOGIC ---
        function calcMortgage() {
            mortgageCalculator.calcMortgage();
            renderAssumptionTransparency();
        }

        function calcAffordability() {
            affordabilityCalculator.calcAffordability();
            renderAssumptionTransparency();
        }

        function calcRentVsBuy() {
            rentBuyCalculator.calcRentVsBuy();
            renderAssumptionTransparency();
            const stressSummaryText = document.getElementById('stressAffordabilityResult')?.innerText ?? '';
            renderDecisionSummary({ stressSummaryText });
        }

        function calcRefinance() {
            refinanceCalculator.calcRefinance();
            renderAssumptionTransparency();
        }

        // --- UI & EVENT BINDING ---
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(`content-${tabId}`).classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');
            runTabCalc(tabId);
        }

        const addInputChangeListener = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) return;
            ['input', 'change'].forEach(evt => el.addEventListener(evt, handler));
        };
        const runCoreCalcs = () => {
            calcMortgage();
            calcAffordability();
            calcRentVsBuy();
        };
        const runMortgageAndRentCalcs = () => {
            calcMortgage();
            calcRentVsBuy();
        };
        const SCENARIO_STORAGE_KEY = 'mortgageSuiteScenario.v1';
        const SCENARIO_STATUS_BASE_CLASS = 'text-[11px] font-medium';
        const PRINT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        let printRestoreState = null;
        let scenarioStatusTimeout = null;

        const getActiveTabId = () => document.querySelector('.tab-btn.active')?.dataset?.tab ?? 'mortgage';
        const isKnownTab = (tabId) => ['mortgage', 'afford', 'rentbuy', 'refinance'].includes(tabId);
        const runTabCalc = (tabId) => {
            if (tabId === 'mortgage') calcMortgage();
            if (tabId === 'afford') calcAffordability();
            if (tabId === 'rentbuy') calcRentVsBuy();
            if (tabId === 'refinance') calcRefinance();
        };

        const setScenarioStatus = (message = '', tone = 'neutral') => {
            const statusEl = document.getElementById('scenarioStatus');
            if (!statusEl) return;
            const toneClass = ({
                neutral: 'text-gray-500',
                success: 'text-emerald-700',
                warning: 'text-amber-700',
                error: 'text-rose-700'
            })[tone] ?? 'text-gray-500';
            statusEl.className = `${SCENARIO_STATUS_BASE_CLASS} ${toneClass}`;
            statusEl.innerText = message;
            if (scenarioStatusTimeout) clearTimeout(scenarioStatusTimeout);
            if (message) {
                scenarioStatusTimeout = setTimeout(() => {
                    statusEl.innerText = '';
                    statusEl.className = `${SCENARIO_STATUS_BASE_CLASS} text-gray-500`;
                    scenarioStatusTimeout = null;
                }, 4500);
            }
        };

        const setPrintGeneratedTimestamp = (date = new Date()) => {
            const generatedAtEl = document.getElementById('printGeneratedAt');
            if (!generatedAtEl) return;
            generatedAtEl.innerText = PRINT_TIMESTAMP_FORMATTER.format(date);
        };

        const collectScenarioPayload = () => {
            const fields = {};
            document.querySelectorAll('input[id], select[id], textarea[id]').forEach((el) => {
                if (el.type === 'checkbox') {
                    fields[el.id] = { type: 'checkbox', checked: Boolean(el.checked) };
                    return;
                }
                fields[el.id] = { type: 'value', value: String(el.value ?? '') };
            });
            return {
                version: 1,
                savedAt: new Date().toISOString(),
                activeTab: getActiveTabId(),
                fields
            };
        };

        const applyScenarioPayload = (payload) => {
            if (!payload || typeof payload !== 'object' || !payload.fields) return false;
            Object.entries(payload.fields).forEach(([id, field]) => {
                const el = document.getElementById(id);
                if (!el || !field || typeof field !== 'object') return;
                if (field.type === 'checkbox' && typeof field.checked !== 'undefined' && 'checked' in el) {
                    el.checked = Boolean(field.checked);
                    return;
                }
                if ('value' in field) {
                    el.value = String(field.value ?? '');
                }
            });

            updateModeVisibility();
            updateConventionalPmiControls();
            if (!Object.prototype.hasOwnProperty.call(payload.fields, 'loanToValue')) syncPercentFromDownPayment();

            const targetTab = isKnownTab(payload.activeTab) ? payload.activeTab : 'mortgage';
            switchTab(targetTab);
            runCoreCalcs();
            calcRefinance();
            syncModalBodyLock();
            return true;
        };

        const saveScenarioToStorage = () => {
            try {
                const payload = collectScenarioPayload();
                window.localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(payload));
                setScenarioStatus(`Scenario saved (${PRINT_TIMESTAMP_FORMATTER.format(new Date(payload.savedAt))}).`, 'success');
            } catch (error) {
                setScenarioStatus('Could not save scenario in this browser.', 'error');
            }
        };

        const loadScenarioFromStorage = () => {
            try {
                const raw = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
                if (!raw) {
                    setScenarioStatus('No saved scenario found yet.', 'warning');
                    return;
                }
                const parsed = JSON.parse(raw);
                if (!applyScenarioPayload(parsed)) {
                    setScenarioStatus('Saved scenario format is invalid.', 'error');
                    return;
                }
                const savedAtLabel = parsed?.savedAt ? PRINT_TIMESTAMP_FORMATTER.format(new Date(parsed.savedAt)) : 'previous save';
                setScenarioStatus(`Scenario loaded (${savedAtLabel}).`, 'success');
            } catch (error) {
                setScenarioStatus('Could not load saved scenario.', 'error');
            }
        };

        const prepareForPrint = () => {
            const cashBreakdownDetails = document.getElementById('cashBreakdownDetails');
            if (!printRestoreState) {
                printRestoreState = {
                    scrollX: window.scrollX,
                    scrollY: window.scrollY,
                    cashBreakdownOpen: Boolean(cashBreakdownDetails?.open)
                };
            }
            closeAllPopups();
            if (cashBreakdownDetails) cashBreakdownDetails.open = true;
            runCoreCalcs();
            calcRefinance();
            setPrintGeneratedTimestamp(new Date());
            window.scrollTo(0, 0);
        };

        const restoreAfterPrint = () => {
            if (!printRestoreState) return;
            const cashBreakdownDetails = document.getElementById('cashBreakdownDetails');
            if (cashBreakdownDetails) cashBreakdownDetails.open = Boolean(printRestoreState.cashBreakdownOpen);
            window.scrollTo(printRestoreState.scrollX, printRestoreState.scrollY);
            printRestoreState = null;
            syncModalBodyLock();
        };

        function init() {
            // Currency formatting setup
            document.querySelectorAll('input[data-currency="true"]').forEach(input => {
                input.addEventListener('blur', e => {
                    const val = parseFloat(e.target.value.replace(/,/g, ''));
                    if (!isNaN(val)) e.target.value = val.toLocaleString();
                });
                input.addEventListener('focus', e => e.target.value = e.target.value.replace(/,/g, ''));
            });

            // Tab listeners
            document.querySelectorAll('[data-tab]').forEach(btn => {
                btn.addEventListener('click', () => switchTab(btn.dataset.tab));
            });

            document.querySelectorAll('[data-breakdown-popup-trigger]').forEach((button) => {
                button.addEventListener('click', () => {
                    openBreakdownPopup();
                });
            });

            const openAmortizationPopupBtn = document.getElementById('openAmortizationPopupBtn');
            if (openAmortizationPopupBtn) {
                openAmortizationPopupBtn.addEventListener('click', () => {
                    openAmortizationPopup();
                });
            }

            const closeBreakdownPopupBtn = document.getElementById('closeBreakdownPopupBtn');
            if (closeBreakdownPopupBtn) {
                closeBreakdownPopupBtn.addEventListener('click', () => {
                    closePopup('breakdownPopup');
                });
            }

            const closeAmortizationPopupBtn = document.getElementById('closeAmortizationPopupBtn');
            if (closeAmortizationPopupBtn) {
                closeAmortizationPopupBtn.addEventListener('click', () => {
                    closePopup('amortizationPopup');
                });
            }

            const breakdownPopupEl = document.getElementById('breakdownPopup');
            if (breakdownPopupEl) {
                breakdownPopupEl.addEventListener('click', (event) => {
                    if (event.target === breakdownPopupEl) closePopup('breakdownPopup');
                });
            }

            const amortizationPopupEl = document.getElementById('amortizationPopup');
            if (amortizationPopupEl) {
                amortizationPopupEl.addEventListener('click', (event) => {
                    if (event.target === amortizationPopupEl) closePopup('amortizationPopup');
                });
            }

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') closeAllPopups();
            });

            const saveScenarioBtn = document.getElementById('saveScenarioBtn');
            if (saveScenarioBtn) {
                saveScenarioBtn.addEventListener('click', saveScenarioToStorage);
            }

            const loadScenarioBtn = document.getElementById('loadScenarioBtn');
            if (loadScenarioBtn) {
                loadScenarioBtn.addEventListener('click', loadScenarioFromStorage);
            }

            window.addEventListener('beforeprint', () => {
                prepareForPrint();
            });
            window.addEventListener('afterprint', () => {
                restoreAfterPrint();
            });

            const coreInputs = [
                'interestRate', 'loanTerm',
                'propertyTax', 'homeInsurance', 'hoaFee', 'pmiRate', 'convPmiDropLtv',
                'extraPayment', 'extraPaymentYears', 'biWeeklyToggle', 'lumpSumAmount', 'lumpSumMonth', 'recastToggle', 'recastFee',
                'discountPoints', 'lenderFees', 'otherClosingCosts', 'prepaidItems',
                'includePointsToggle', 'includeLenderFeesToggle', 'includeOtherCostsToggle', 'includePrepaidsToggle',
                'financePointsToggle', 'financeCostsToggle', 'govtFeeMode', 'vaFeeExempt',
                'affordIncome', 'affordDebts', 'affordDown', 'affordRate', 'affordFixed',
                'affordFrontDti', 'affordBackDti', 'affordStressRate',
                'affordMode', 'rbMode'
            ];
            coreInputs.forEach(id => addInputChangeListener(id, () => {
                runCoreCalcs();
            }));

            ['rbPrice', 'rbRent', 'rbApprec', 'rbRentInf', 'rbMaint', 'rbClosing', 'rbInvestReturn', 'rbTaxTreatment', 'rbMarginalTax', 'rbStdDeduction']
                .forEach(id => addInputChangeListener(id, calcRentVsBuy));

            ['refiBal', 'refiRateOld', 'refiPayOld', 'refiRateNew', 'refiTermNew', 'refiCost']
                .forEach(id => addInputChangeListener(id, calcRefinance));

            addInputChangeListener('convPmiRule', () => {
                updateConventionalPmiControls();
                runMortgageAndRentCalcs();
            });

            const propertyListingUrlEl = document.getElementById('propertyListingUrl');
            const applyLocationEstimateBtn = document.getElementById('applyLocationEstimateBtn');
            const applyLiveRateBtn = document.getElementById('applyLiveRateBtn');
            const applyLocationEstimate = async (options = {}) => {
                const applied = await applyLocationEstimateFromInputs(options);
                if (!applied) return;
                runCoreCalcs();
            };
            let isApplyingLiveRate = false;
            const applyLiveRate = async () => {
                if (isApplyingLiveRate) return;
                isApplyingLiveRate = true;
                if (applyLiveRateBtn) applyLiveRateBtn.disabled = true;

                const termYears = getVal('loanTerm');
                const preferredSeries = resolveFredSeriesForTerm(termYears);
                const loadingLabel = preferredSeries.exactMatch
                    ? `${preferredSeries.requestedTerm}-year`
                    : '30-year';
                setLiveRateHint(`Fetching latest ${loadingLabel} mortgage average...`, 'info');

                try {
                    const latest = await fetchLatestFreddieMacRate(termYears);
                    setNumberInput('interestRate', latest.rate, 2);
                    runCoreCalcs();

                    const benchmarkLabel = latest.seriesId === FRED_SERIES_BY_TERM[15] ? '15-year' : '30-year';
                    const termNote = latest.exactMatch
                        ? ''
                        : ` ${latest.requestedTerm}-year loans use the ${benchmarkLabel} benchmark.`;
                    setLiveRateHint(`Applied ${latest.rate.toFixed(2)}% from ${benchmarkLabel} PMMS (${latest.date}).${termNote}`, latest.exactMatch ? 'success' : 'warn');
                } catch (error) {
                    setLiveRateHint('Live-rate data is unavailable on this host. Refresh after the latest GitHub Pages deploy, or run `npm run dev` locally and retry.', 'warn');
                } finally {
                    isApplyingLiveRate = false;
                    if (applyLiveRateBtn) applyLiveRateBtn.disabled = false;
                }
            };
            if (applyLocationEstimateBtn) {
                applyLocationEstimateBtn.addEventListener('click', () => {
                    void applyLocationEstimate();
                });
            }
            if (applyLiveRateBtn) {
                applyLiveRateBtn.addEventListener('click', () => {
                    void applyLiveRate();
                });
            }
            if (propertyListingUrlEl) {
                propertyListingUrlEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void applyLocationEstimate();
                    }
                });
            }

            document.getElementById('homePrice').addEventListener('input', () => {
                syncDownPaymentFromPercent();
                syncMortgageInsuranceRateFromLoanInputs();
                runCoreCalcs();
            });

            document.getElementById('downPaymentPercent').addEventListener('input', () => {
                syncDownPaymentFromPercent();
                syncMortgageInsuranceRateFromLoanInputs();
                runMortgageAndRentCalcs();
            });

            document.getElementById('loanToValue').addEventListener('input', () => {
                syncDownPaymentFromLoanToValue();
                syncMortgageInsuranceRateFromLoanInputs();
                runMortgageAndRentCalcs();
            });

            document.getElementById('downPayment').addEventListener('input', () => {
                syncPercentFromDownPayment();
                syncMortgageInsuranceRateFromLoanInputs();
                runMortgageAndRentCalcs();
            });

            document.getElementById('loanType').addEventListener('change', (e) => {
                const type = e.target.value;
                const pctInput = document.getElementById('downPaymentPercent');
                if (type === 'fha') pctInput.value = 3.5;
                else if (type === 'va') pctInput.value = 0;
                else pctInput.value = 5;

                syncDownPaymentFromPercent();
                syncMortgageInsuranceRateFromLoanInputs();
                runMortgageAndRentCalcs();
            });

            document.getElementById('mobileEditInputsBtn').onclick = () => window.scrollTo({top: 0, behavior: 'smooth'});
            
            // Run initial calcs
            updateModeVisibility();
            updateConventionalPmiControls();
            setLocationQualityBadge('unknown');
            setLocationEstimateHint('Paste a Realtor listing URL and apply it to auto-fill home price, property tax, and HOA. HOA defaults to $0 when no fee is found.');
            setLiveRateHint('Uses Freddie Mac PMMS weekly averages via FRED (15-year and 30-year series).');
            syncDownPaymentFromPercent();
            syncMortgageInsuranceRateFromLoanInputs();
            syncModalBodyLock();
            runCoreCalcs();
            calcRefinance();
            setPrintGeneratedTimestamp(new Date());
        }

        window.onload = init;
