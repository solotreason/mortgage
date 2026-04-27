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
        const formatPercent = (n, digits = 2) => `${(Number.isFinite(n) ? n * 100 : 0).toFixed(digits)}%`;

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

        const RATE_EPSILON = 1e-10;
        const SALT_CAP_ANNUAL = 10000;
        const DEFAULT_LOCATION_PROFILE = { label: 'U.S. Baseline', taxRate: 0.0110, insuranceRate: 0.0065 };
        const CITY_SEARCH_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
        const ACS_YEAR_CANDIDATES = [2024, 2023, 2022];
        const STAY_AFLOAT_POLICY_VERSION = 'Stay Afloat Policy v1';
        const LOCATION_QUALITY_META = {
            city: {
                label: 'Live city match',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 border-emerald-200 text-emerald-800'
            },
            county: {
                label: 'County proxy',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sky-50 border-sky-200 text-sky-800'
            },
            metro: {
                label: 'Metro proxy',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-cyan-50 border-cyan-200 text-cyan-800'
            },
            state: {
                label: 'State proxy',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-50 border-amber-200 text-amber-800'
            },
            us: {
                label: 'U.S. baseline',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-gray-100 border-gray-300 text-gray-700'
            },
            unknown: {
                label: 'Not applied',
                className: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-indigo-50 border-indigo-200 text-indigo-700'
            }
        };
        const MORTGAGED_INSURANCE_BUCKETS = [
            { variable: 'B25141_003E', midpoint: 50 },
            { variable: 'B25141_004E', midpoint: 200 },
            { variable: 'B25141_005E', midpoint: 400 },
            { variable: 'B25141_006E', midpoint: 650 },
            { variable: 'B25141_007E', midpoint: 900 },
            { variable: 'B25141_008E', midpoint: 1250 },
            { variable: 'B25141_009E', midpoint: 1750 },
            { variable: 'B25141_010E', midpoint: 2250 },
            { variable: 'B25141_011E', midpoint: 2750 },
            { variable: 'B25141_012E', midpoint: 3250 },
            { variable: 'B25141_013E', midpoint: 3750 },
            { variable: 'B25141_014E', midpoint: 4500 }
        ];
        const STATE_FIPS_BY_CODE = {
            AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12',
            GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23',
            MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33',
            NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
            SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56'
        };
        const STATE_CODE_BY_NAME = {
            alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
            delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
            indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
            massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
            nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
            'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
            'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
            vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY'
        };
        const locationLiveState = { options: [], suggestionsAbortController: null };
        const locationEstimateState = {
            source: 'unknown',
            sourceYear: null,
            sourceName: '',
            isProgrammaticWrite: false,
            manualLocks: { tax: false, insurance: false }
        };
        const REQUEST_GUARD_WINDOW_MS = 60000;
        const REQUEST_GUARD_MAX_PER_WINDOW = 60;
        const REQUEST_GUARD_MAX_PER_SESSION = 400;
        const requestGuardState = new Map();
        const acsPlaceRowsCache = new Map();
        const acsCountyRowsCache = new Map();
        const acsMetroRowsCache = new Map();
        const acsStateRowsCache = new Map();
        const ACS_REQUESTED_VARIABLES = ['NAME', 'B25077_001E', 'B25103_001E', ...MORTGAGED_INSURANCE_BUCKETS.map(bucket => bucket.variable)].join(',');

        const toFiniteNumber = (value) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const normalizeLocationText = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const normalizeCityNameForMatch = (value) => normalizeLocationText(value)
            .replace(/\b(cdp|city and borough|city|township|town|village|borough|municipality|municipio|census designated place)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const normalizeCountyNameForMatch = (value) => normalizeLocationText(value)
            .replace(/\b(county|parish|borough|census area|municipio|city and borough)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const normalizeMetroNameForMatch = (value) => normalizeLocationText(value)
            .replace(/\b(metro area|metropolitan statistical area|micropolitan statistical area|msa)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const parseStateCodeFromText = (value) => {
            const match = String(value ?? '').trim().match(/,\s*([a-z]{2})$/i);
            return match ? match[1].toUpperCase() : '';
        };
        const getStateCode = (stateText) => {
            const normalized = normalizeLocationText(stateText);
            if (!normalized) return '';
            if (normalized.length === 2) return normalized.toUpperCase();
            return STATE_CODE_BY_NAME[normalized] ?? '';
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

        const scoreNameMatch = (normalizedTarget, normalizedCandidate) => {
            if (!normalizedTarget || !normalizedCandidate) return 0;
            if (normalizedTarget === normalizedCandidate) return 4;
            if (normalizedCandidate.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedCandidate)) return 3;
            if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) return 2;
            const targetWords = normalizedTarget.split(' ').filter(Boolean);
            const candidateWords = normalizedCandidate.split(' ').filter(Boolean);
            const overlap = targetWords.filter(word => candidateWords.includes(word)).length;
            if (overlap >= 2) return 1;
            return 0;
        };

        const setLocationQualityBadge = (source = 'unknown', sourceYear = null) => {
            const badgeEl = document.getElementById('locationQualityBadge');
            if (!badgeEl) return;
            const meta = LOCATION_QUALITY_META[source] ?? LOCATION_QUALITY_META.unknown;
            badgeEl.className = meta.className;
            badgeEl.innerText = sourceYear ? `${meta.label} (${sourceYear})` : meta.label;
        };

        const setLocationManualLockHint = () => {
            const lockHintEl = document.getElementById('locationManualLockHint');
            if (!lockHintEl) return;
            const locked = [];
            if (locationEstimateState.manualLocks.tax) locked.push('tax');
            if (locationEstimateState.manualLocks.insurance) locked.push('insurance');
            if (!locked.length) {
                lockHintEl.innerText = '';
                return;
            }
            const lockLabel = locked.length === 2 ? 'tax and insurance values' : `${locked[0]} value`;
            lockHintEl.innerText = `Manual ${lockLabel} locked. Use "Apply City Estimate" to overwrite.`;
        };

        const withProgrammaticLocationWrite = (fn) => {
            locationEstimateState.isProgrammaticWrite = true;
            try {
                fn();
            } finally {
                locationEstimateState.isProgrammaticWrite = false;
            }
        };

        const setCityAutocompleteOptions = (options) => {
            const datalist = document.getElementById('locationCityOptions');
            if (!datalist) return;
            datalist.replaceChildren();
            options.forEach((option) => {
                const el = document.createElement('option');
                el.value = String(option.display ?? '');
                datalist.appendChild(el);
            });
        };

        const fetchCitySuggestions = async (query) => {
            const safeQuery = String(query ?? '').trim();
            if (safeQuery.length < 2) return [];
            if (locationLiveState.suggestionsAbortController) {
                locationLiveState.suggestionsAbortController.abort();
            }
            const abortController = new AbortController();
            locationLiveState.suggestionsAbortController = abortController;
            try {
                const url = `${CITY_SEARCH_ENDPOINT}?name=${encodeURIComponent(safeQuery)}&count=8&language=en&format=json&countryCode=US`;
                const data = await fetchJsonWithTimeout(url, 12000, abortController.signal);
                const rawResults = Array.isArray(data?.results) ? data.results : [];

                const deduped = [];
                const seen = new Set();
                rawResults.forEach((result) => {
                    const stateCode = getStateCode(result.admin1);
                    const cityName = String(result.name ?? '').trim();
                    if (!cityName || !stateCode) return;
                    const display = `${cityName}, ${stateCode}`;
                    const dedupeKey = normalizeLocationText(display);
                    if (seen.has(dedupeKey)) return;
                    seen.add(dedupeKey);
                    deduped.push({
                        name: cityName,
                        stateCode,
                        stateName: String(result.admin1 ?? ''),
                        countyName: String(result.admin2 ?? ''),
                        display,
                        latitude: toFiniteNumber(result.latitude),
                        longitude: toFiniteNumber(result.longitude),
                        population: toFiniteNumber(result.population)
                    });
                });

                deduped.sort((a, b) => b.population - a.population);
                return deduped;
            } finally {
                if (locationLiveState.suggestionsAbortController === abortController) {
                    locationLiveState.suggestionsAbortController = null;
                }
            }
        };

        const resolveCityCandidateFromInput = () => {
            const cityInputEl = document.getElementById('locationCity');
            const inputValue = cityInputEl?.value?.trim() ?? '';
            if (!inputValue) return null;

            const normalizedInput = normalizeLocationText(inputValue);
            const matchedOption = locationLiveState.options.find(option => (
                normalizeLocationText(option.display) === normalizedInput
                || normalizeLocationText(option.name) === normalizedInput
            ));
            if (matchedOption) return matchedOption;

            const stateCode = parseStateCodeFromText(inputValue);
            const cityName = inputValue.split(',')[0]?.trim() ?? '';
            if (!cityName) return null;
            return {
                name: cityName,
                stateCode,
                stateName: '',
                countyName: '',
                display: stateCode ? `${cityName}, ${stateCode}` : cityName,
                latitude: 0,
                longitude: 0,
                population: 0
            };
        };

        const findBestAcsPlaceRow = (rows, cityName) => {
            const target = normalizeCityNameForMatch(cityName);
            if (!target) return null;

            let best = null;
            let bestScore = 0;
            rows.forEach((row) => {
                const placeName = String(row.NAME ?? '').split(',')[0];
                const normalizedPlace = normalizeCityNameForMatch(placeName);
                const score = scoreNameMatch(target, normalizedPlace);
                if (score > bestScore) {
                    best = row;
                    bestScore = score;
                }
            });
            return bestScore > 0 ? best : null;
        };

        const findBestAcsCountyRow = (rows, countyName) => {
            const target = normalizeCountyNameForMatch(countyName);
            if (!target) return null;

            let best = null;
            let bestScore = 0;
            rows.forEach((row) => {
                const countyLabel = String(row.NAME ?? '').split(',')[0];
                const normalizedCounty = normalizeCountyNameForMatch(countyLabel);
                const score = scoreNameMatch(target, normalizedCounty);
                if (score > bestScore) {
                    best = row;
                    bestScore = score;
                }
            });
            return bestScore > 0 ? best : null;
        };

        const metroIncludesStateCode = (metroName, stateCode) => {
            const code = String(stateCode ?? '').toUpperCase();
            if (!code) return false;
            const upper = String(metroName ?? '').toUpperCase();
            const stateRegex = new RegExp(`(^|[^A-Z])${code}([^A-Z]|$)`);
            return stateRegex.test(upper);
        };

        const findBestAcsMetroRow = (rows, { cityName, stateCode }) => {
            const target = normalizeCityNameForMatch(cityName);
            if (!target) return null;
            const stateFiltered = rows.filter(row => metroIncludesStateCode(row.NAME, stateCode));
            const pool = stateFiltered.length ? stateFiltered : rows;

            let best = null;
            let bestScore = 0;
            pool.forEach((row) => {
                const metroLabel = String(row.NAME ?? '').split(',')[0];
                const normalizedMetro = normalizeMetroNameForMatch(metroLabel);
                const score = scoreNameMatch(target, normalizedMetro);
                if (score > bestScore) {
                    best = row;
                    bestScore = score;
                }
            });
            return bestScore > 0 ? best : null;
        };

        const estimateAnnualInsuranceFromBuckets = (row) => {
            let weightedTotal = 0;
            let totalCount = 0;
            MORTGAGED_INSURANCE_BUCKETS.forEach(({ variable, midpoint }) => {
                const count = Math.max(0, toFiniteNumber(row[variable]));
                if (count <= 0) return;
                weightedTotal += count * midpoint;
                totalCount += count;
            });
            if (totalCount <= 0) return 0;
            return weightedTotal / totalCount;
        };

        const fetchAcsRows = async ({ year, geography, stateFips }) => {
            const cacheKey = geography === 'metro' || geography === 'state'
                ? `${year}`
                : `${year}-${stateFips}`;
            const cache = geography === 'place'
                ? acsPlaceRowsCache
                : geography === 'county'
                    ? acsCountyRowsCache
                    : geography === 'metro'
                        ? acsMetroRowsCache
                        : acsStateRowsCache;
            if (cache.has(cacheKey)) return cache.get(cacheKey);

            const params = new URLSearchParams({ get: ACS_REQUESTED_VARIABLES });
            if (geography === 'place') {
                params.set('for', 'place:*');
                params.set('in', `state:${stateFips}`);
            } else if (geography === 'county') {
                params.set('for', 'county:*');
                params.set('in', `state:${stateFips}`);
            } else if (geography === 'metro') {
                params.set('for', 'metropolitan statistical area/micropolitan statistical area:*');
            } else if (geography === 'state') {
                params.set('for', 'state:*');
            } else {
                throw new Error(`unsupported-geography-${geography}`);
            }

            const endpoint = `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
            const data = await fetchJsonWithTimeout(endpoint, 22000);
            if (!Array.isArray(data) || data.length < 2) {
                cache.set(cacheKey, []);
                return [];
            }
            const [header, ...rows] = data;
            const objects = rows.map(row => Object.fromEntries(header.map((key, idx) => [key, row[idx]])));
            cache.set(cacheKey, objects);
            return objects;
        };

        const extractRatesFromAcsRow = (row) => {
            const medianHomeValue = Math.max(0, toFiniteNumber(row?.B25077_001E));
            const medianTax = Math.max(0, toFiniteNumber(row?.B25103_001E));
            const annualInsuranceEstimate = Math.max(0, estimateAnnualInsuranceFromBuckets(row ?? {}));
            if (medianHomeValue <= 0) return null;
            const taxRate = clamp(medianTax / medianHomeValue, 0.002, 0.05);
            const insuranceRate = clamp(annualInsuranceEstimate / medianHomeValue, 0.001, 0.04);
            return {
                medianHomeValue,
                medianTax,
                annualInsuranceEstimate,
                taxRate,
                insuranceRate
            };
        };

        const fetchAcsLocationRates = async ({ cityName, countyName, stateCode }) => {
            const normalizedStateCode = String(stateCode ?? '').toUpperCase();
            const stateFips = STATE_FIPS_BY_CODE[normalizedStateCode];
            if (!stateFips) throw new Error('missing-state-code');

            for (const year of ACS_YEAR_CANDIDATES) {
                try {
                    const placeRows = await fetchAcsRows({ year, geography: 'place', stateFips });
                    const placeRow = findBestAcsPlaceRow(placeRows, cityName);
                    const placeRates = extractRatesFromAcsRow(placeRow);
                    if (placeRow && placeRates) {
                        return {
                            ...placeRates,
                            source: 'city',
                            sourceName: String(placeRow.NAME ?? cityName),
                            year
                        };
                    }
                } catch (error) {
                    // Continue down the fallback ladder.
                }

                try {
                    if (countyName) {
                        const countyRows = await fetchAcsRows({ year, geography: 'county', stateFips });
                        const countyRow = findBestAcsCountyRow(countyRows, countyName);
                        const countyRates = extractRatesFromAcsRow(countyRow);
                        if (countyRow && countyRates) {
                            return {
                                ...countyRates,
                                source: 'county',
                                sourceName: String(countyRow.NAME ?? countyName),
                                year
                            };
                        }
                    }
                } catch (error) {
                    // Continue down the fallback ladder.
                }

                try {
                    const metroRows = await fetchAcsRows({ year, geography: 'metro', stateFips });
                    const metroRow = findBestAcsMetroRow(metroRows, { cityName, stateCode: normalizedStateCode });
                    const metroRates = extractRatesFromAcsRow(metroRow);
                    if (metroRow && metroRates) {
                        return {
                            ...metroRates,
                            source: 'metro',
                            sourceName: String(metroRow.NAME ?? cityName),
                            year
                        };
                    }
                } catch (error) {
                    // Continue down the fallback ladder.
                }

                try {
                    const stateRows = await fetchAcsRows({ year, geography: 'state', stateFips });
                    const stateRow = stateRows.find(row => String(row.state ?? '') === stateFips);
                    const stateRates = extractRatesFromAcsRow(stateRow);
                    if (stateRow && stateRates) {
                        return {
                            ...stateRates,
                            source: 'state',
                            sourceName: String(stateRow.NAME ?? normalizedStateCode),
                            year
                        };
                    }
                } catch (error) {
                    // Continue to next year before defaulting to U.S. baseline.
                }
            }

            throw new Error('acs-location-data-unavailable');
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

        const getUsBaselineLocationProfile = () => ({
            source: 'us',
            sourceName: DEFAULT_LOCATION_PROFILE.label,
            year: null,
            taxRate: DEFAULT_LOCATION_PROFILE.taxRate,
            insuranceRate: DEFAULT_LOCATION_PROFILE.insuranceRate
        });

        const getLocationProfileFromCandidate = async (candidate) => {
            if (!candidate?.stateCode) return getUsBaselineLocationProfile();
            try {
                return await fetchAcsLocationRates({
                    cityName: candidate.name,
                    countyName: candidate.countyName,
                    stateCode: candidate.stateCode
                });
            } catch (error) {
                return getUsBaselineLocationProfile();
            }
        };

        const setActiveLocationProfile = (profile) => {
            locationEstimateState.source = profile.source;
            locationEstimateState.sourceYear = profile.year ?? null;
            locationEstimateState.sourceName = profile.sourceName ?? '';
            setLocationQualityBadge(profile.source, profile.year ?? null);
            setLocationManualLockHint();
        };

        const getManualRetentionHint = ({ shouldWriteTax, shouldWriteInsurance }) => {
            const retainedFields = [];
            if (!shouldWriteTax) retainedFields.push('tax');
            if (!shouldWriteInsurance) retainedFields.push('insurance');
            if (!retainedFields.length) return '';
            return ` Kept your manual ${retainedFields.join(' and ')} value${retainedFields.length > 1 ? 's' : ''}.`;
        };

        const buildLocationEstimateMessage = ({ locationProfile, retainedText, pmiText }) => {
            const qualityLabel = (LOCATION_QUALITY_META[locationProfile.source] ?? LOCATION_QUALITY_META.unknown).label;
            const sourceLead = locationProfile.source === 'us'
                ? `Used ${qualityLabel}`
                : `Applied ${qualityLabel} data (${locationProfile.sourceName})`;
            return `${sourceLead}. Tax ${formatPercent(locationProfile.taxRate)}, insurance ${formatPercent(locationProfile.insuranceRate)}.${retainedText} ${pmiText}`;
        };

        const selectBestCityCandidate = ({ locationCity, candidate, suggestions }) => {
            const options = Array.isArray(suggestions) ? suggestions : [];
            if (!options.length) return candidate;

            const normalizedInput = normalizeLocationText(locationCity);
            const normalizedCandidateName = normalizeCityNameForMatch(candidate?.name ?? locationCity);
            let best = null;
            let bestScore = -1;
            options.forEach((option) => {
                let score = 0;
                if (normalizeLocationText(option.display) === normalizedInput) score += 6;
                if (normalizeLocationText(option.name) === normalizedInput) score += 5;
                score += scoreNameMatch(normalizedCandidateName, normalizeCityNameForMatch(option.name));
                if (candidate?.stateCode && option.stateCode === candidate.stateCode) score += 2;
                if (score > bestScore) {
                    best = option;
                    bestScore = score;
                }
            });

            if (!best) return candidate;
            if (!candidate) return best;
            return {
                ...candidate,
                ...best,
                stateCode: candidate.stateCode || best.stateCode,
                countyName: candidate.countyName || best.countyName,
                stateName: candidate.stateName || best.stateName,
                display: best.display || candidate.display
            };
        };

        async function applyLocationEstimateFromInputs({ forceOverwriteManual = false } = {}) {
            const homePrice = getVal('homePrice');
            if (homePrice <= 0) {
                setLocationEstimateHint('Enter a home price first, then apply location estimates.', 'warn');
                return false;
            }

            const cityInputEl = document.getElementById('locationCity');
            const locationCity = cityInputEl?.value?.trim() ?? '';
            if (!locationCity) {
                setLocationEstimateHint('Enter a city (for example: Austin, TX), then apply the estimate.', 'warn');
                return false;
            }

            const downPayment = getVal('downPayment');
            const loanType = getSelectVal('loanType', 'conventional');
            const annualPmiRate = estimateAnnualMortgageInsuranceRate({ loanType, homePrice, downPayment });
            const effectiveDown = clamp(downPayment, 0, homePrice);
            const ltv = homePrice > RATE_EPSILON
                ? (Math.max(0, homePrice - effectiveDown) / homePrice)
                : 1;
            const pmiText = loanType === 'va'
                ? 'PMI/MIP set to 0.00% for VA.'
                : `PMI/MIP estimated at ${formatPercent(annualPmiRate)} for ${formatPercent(ltv)} LTV.`;

            setLocationEstimateHint(`Fetching live city data for ${locationCity}...`, 'info');

            let candidate = resolveCityCandidateFromInput();
            let suggestions = [];
            try {
                suggestions = await fetchCitySuggestions(locationCity);
            } catch (error) {
                suggestions = [];
            }
            locationLiveState.options = suggestions;
            setCityAutocompleteOptions(suggestions);
            candidate = selectBestCityCandidate({ locationCity, candidate, suggestions });

            const locationProfile = await getLocationProfileFromCandidate(candidate);

            const shouldWriteTax = forceOverwriteManual || !locationEstimateState.manualLocks.tax;
            const shouldWriteInsurance = forceOverwriteManual || !locationEstimateState.manualLocks.insurance;
            withProgrammaticLocationWrite(() => {
                if (shouldWriteTax) setCurrencyInput('propertyTax', homePrice * locationProfile.taxRate);
                if (shouldWriteInsurance) setCurrencyInput('homeInsurance', homePrice * locationProfile.insuranceRate);
                setNumberInput('pmiRate', annualPmiRate * 100, 2);
            });
            if (forceOverwriteManual) {
                locationEstimateState.manualLocks.tax = false;
                locationEstimateState.manualLocks.insurance = false;
            }
            if (cityInputEl && candidate?.display) cityInputEl.value = candidate.display;

            setActiveLocationProfile(locationProfile);
            const retainedText = getManualRetentionHint({ shouldWriteTax, shouldWriteInsurance });
            const message = buildLocationEstimateMessage({ locationProfile, retainedText, pmiText });
            const tone = locationProfile.source === 'us' || Boolean(retainedText) ? 'warn' : 'success';
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
        let balanceChart = null;
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
            const chartCanvas = document.getElementById('breakdownPopupChart');
            if (!detailsEl || !chartCanvas) return;

            const rows = getVisibleBreakdownRows();
            if (!rows.length) {
                detailsEl.replaceChildren();
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
            detailsEl.replaceChildren();
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
            if (breakdownPopupChart) breakdownPopupChart.destroy();
            breakdownPopupChart = new Chart(chartCanvas, {
                type: 'doughnut',
                data: {
                    labels: payload.labels,
                    datasets: [{ data: payload.data, backgroundColor: payload.colors }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
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
                miPaid: selectedRows.reduce((sum, row) => sum + row.pmi, 0),
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

            setElText('escrowIncluded', `Included in estimate: Property tax (${formatMoney(taxMonthly)}/mo) + homeowners insurance (${formatMoney(insuranceMonthly)}/mo).`);
            setElText('escrowExcluded', `Typically excluded from escrow: HOA dues (${formatMoney(hoaMonthly)}/mo), even though included in total monthly housing estimate.`);
            setElText('escrowAssumption', 'Assumes taxes/insurance are paid monthly. Confirm actual escrow setup with lender.');

            const totalOfPaymentsEstimate = schedule.totalPaid + loanProfile.upfrontFinanceCharges;
            const tip = loanProfile.noteLoanAmount > 0 ? (schedule.totalInterest / loanProfile.noteLoanAmount) : 0;
            setElText('loanTotalOfPayments', formatMoney(totalOfPaymentsEstimate));
            setElText('loanTip', formatPercent(tip, 2));

            const sourceMeta = LOCATION_QUALITY_META[locationEstimateState.source] ?? LOCATION_QUALITY_META.unknown;
            const sourceName = locationEstimateState.sourceName || 'Manual/default values';
            const sourceYear = locationEstimateState.sourceYear ? String(locationEstimateState.sourceYear) : 'Not specified';
            const taxLock = locationEstimateState.manualLocks.tax ? 'Tax manually overridden' : 'Tax follows applied estimate';
            const insLock = locationEstimateState.manualLocks.insurance ? 'Insurance manually overridden' : 'Insurance follows applied estimate';
            setElText('dataConfidenceLine', `Source quality: ${sourceMeta.label}. Basis: ${sourceName}.`);
            setElText('dataFreshnessLine', `Source year: ${sourceYear}.`);
            setElText('dataManualOverrideLine', `${taxLock}. ${insLock}.`);

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
            if (!stressResultEl) return;

            if (incomeMonthly <= 0 || maxHousingAtBackDti <= 0) {
                stressResultEl.innerText = 'Can still afford? Unknown (set income/debts)';
                stressResultEl.className = 'text-xs font-semibold text-gray-700';
            } else if (worstCaseMonthly <= maxHousingAtBackDti) {
                const headroom = maxHousingAtBackDti - worstCaseMonthly;
                stressResultEl.innerText = `Can still afford? Yes (${formatMoney(headroom)} headroom)`;
                stressResultEl.className = 'text-xs font-semibold text-emerald-700';
            } else {
                const shortfall = worstCaseMonthly - maxHousingAtBackDti;
                stressResultEl.innerText = `Can still afford? No (${formatMoney(shortfall)} shortfall)`;
                stressResultEl.className = 'text-xs font-semibold text-rose-700';
            }
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
            isSyncingDownPayment = false;
        };

        const syncPercentFromDownPayment = () => {
            if (isSyncingDownPayment) return;
            isSyncingDownPayment = true;
            const homePrice = getVal('homePrice');
            const downPayment = getVal('downPayment');
            const pct = homePrice > 0 ? clamp((downPayment / homePrice) * 100, 0, 100) : 0;
            setNumberInput('downPaymentPercent', pct, 2);
            isSyncingDownPayment = false;
        };

        const formatSignedMoney = (value) => `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;

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
            get balanceChart() { return balanceChart; },
            set balanceChart(value) { balanceChart = value; },
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
            renderWarnings
        });
        const affordabilityCalculator = createAffordabilityCalculator({
            state: affordUiState,
            getVal,
            getSelectVal,
            clamp,
            formatMoney,
            formatPercent,
            renderWarnings,
            updateModeVisibility
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
            getConventionalPmiThresholdPct,
            runRentVsBuyScenario
        });
        const refinanceCalculator = createRefinanceCalculator({
            state: refiUiState,
            getVal,
            formatMoney
        });

        // --- CALCULATION LOGIC ---
        function calcMortgage() {
            mortgageCalculator.calcMortgage();
        }

        function calcAffordability() {
            affordabilityCalculator.calcAffordability();
        }

        function calcRentVsBuy() {
            rentBuyCalculator.calcRentVsBuy();
        }

        function calcRefinance() {
            refinanceCalculator.calcRefinance();
        }

        // --- UI & EVENT BINDING ---
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(`content-${tabId}`).classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');
            if (tabId === 'mortgage') calcMortgage();
            if (tabId === 'afford') calcAffordability();
            if (tabId === 'rentbuy') calcRentVsBuy();
            if (tabId === 'refinance') calcRefinance();
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

            const openBreakdownPopupBtn = document.getElementById('openBreakdownPopupBtn');
            if (openBreakdownPopupBtn) {
                openBreakdownPopupBtn.addEventListener('click', () => {
                    openBreakdownPopup();
                });
            }

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

            ['propertyTax', 'homeInsurance'].forEach((id) => {
                const el = document.getElementById(id);
                if (!el) return;
                const fieldKey = id === 'propertyTax' ? 'tax' : 'insurance';
                ['input', 'change'].forEach((evt) => {
                    el.addEventListener(evt, () => {
                        if (locationEstimateState.isProgrammaticWrite) return;
                        locationEstimateState.manualLocks[fieldKey] = true;
                        setLocationManualLockHint();
                    });
                });
            });

            ['rbPrice', 'rbRent', 'rbApprec', 'rbRentInf', 'rbMaint', 'rbClosing', 'rbInvestReturn', 'rbTaxTreatment', 'rbMarginalTax', 'rbStdDeduction']
                .forEach(id => addInputChangeListener(id, calcRentVsBuy));

            ['refiBal', 'refiRateOld', 'refiPayOld', 'refiRateNew', 'refiTermNew', 'refiCost']
                .forEach(id => addInputChangeListener(id, calcRefinance));

            addInputChangeListener('convPmiRule', () => {
                updateConventionalPmiControls();
                runMortgageAndRentCalcs();
            });

            const locationCityEl = document.getElementById('locationCity');
            const applyLocationEstimateBtn = document.getElementById('applyLocationEstimateBtn');
            const applyLocationEstimate = async (options = {}) => {
                const applied = await applyLocationEstimateFromInputs(options);
                if (!applied) return;
                runCoreCalcs();
            };
            if (applyLocationEstimateBtn) {
                applyLocationEstimateBtn.addEventListener('click', () => {
                    void applyLocationEstimate({ forceOverwriteManual: true });
                });
            }
            if (locationCityEl) {
                locationCityEl.addEventListener('input', () => {
                    const query = locationCityEl.value.trim();
                    if (locationLiveState.suggestionsAbortController) {
                        locationLiveState.suggestionsAbortController.abort();
                    }
                    locationLiveState.options = [];
                    setCityAutocompleteOptions([]);
                    if (query.length < 2) return;
                });
                locationCityEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void applyLocationEstimate();
                    }
                });
            }

            document.getElementById('homePrice').addEventListener('input', () => {
                syncDownPaymentFromPercent();
                runCoreCalcs();
            });

            document.getElementById('downPaymentPercent').addEventListener('input', () => {
                syncDownPaymentFromPercent();
                runMortgageAndRentCalcs();
            });

            document.getElementById('downPayment').addEventListener('input', () => {
                syncPercentFromDownPayment();
                runMortgageAndRentCalcs();
            });

            document.getElementById('loanType').addEventListener('change', (e) => {
                const type = e.target.value;
                const pctInput = document.getElementById('downPaymentPercent');
                if (type === 'fha') pctInput.value = 3.5;
                else if (type === 'va') pctInput.value = 0;
                else pctInput.value = 5;

                syncDownPaymentFromPercent();
                runMortgageAndRentCalcs();
            });

            document.getElementById('mobileEditInputsBtn').onclick = () => window.scrollTo({top: 0, behavior: 'smooth'});
            
            // Run initial calcs
            updateModeVisibility();
            updateConventionalPmiControls();
            setLocationQualityBadge('unknown');
            setLocationManualLockHint();
            setLocationEstimateHint('Enter City, ST and press Enter or click Apply City Estimate. Fallback ladder: City -> County -> Metro -> State -> U.S. baseline.');
            syncDownPaymentFromPercent();
            syncModalBodyLock();
            runCoreCalcs();
            calcRefinance();
        }

        window.onload = init;
