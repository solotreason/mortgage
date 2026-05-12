const LISTING_SOURCE_DOMAINS = Object.freeze({
    realtor: ['realtor.com']
});

const MONEY_TEXT_RE = /\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/;
const CURRENT_YEAR = () => new Date().getFullYear();

const normalizeKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const getListingSourceFromUrl = (rawUrl) => {
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

const parseMoney = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value !== 'string') return 0;
    const match = value.match(MONEY_TEXT_RE);
    if (!match) return 0;
    const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

const parseYear = (value) => {
    if (typeof value === 'number') {
        if (value >= 1900 && value <= 2200) return Math.trunc(value);
        if (value > 946684800000 && value < 4102444800000) return new Date(value).getUTCFullYear();
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const direct = trimmed.match(/\b(19|20|21)\d{2}\b/);
        if (direct) return Number.parseInt(direct[0], 10);
        const asNumber = Number.parseFloat(trimmed);
        if (Number.isFinite(asNumber)) return parseYear(asNumber);
    }
    return 0;
};

const decodeHtmlEntities = (value) => String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));

const extractJsonScriptPayloads = (html) => {
    const payloads = [];
    const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRe.exec(String(html ?? ''))) !== null) {
        const attrs = String(match[1] ?? '');
        const body = decodeHtmlEntities(String(match[2] ?? '').trim());
        if (!body) continue;
        const isJsonScript = /type=["']application\/(?:ld\+)?json["']/i.test(attrs)
            || /id=["']__(?:NEXT|APOLLO|INITIAL)_DATA__["']/i.test(attrs)
            || /id=["']__NEXT_DATA__["']/i.test(attrs);
        const looksLikeJson = body.startsWith('{') || body.startsWith('[');
        const hasUsefulTerms = /tax|hoa|association|homeowners|price|listing|home|property|sale|offer|estimate|zestimate|bed|bath|sqft|square|address|location/i.test(body);
        if (!isJsonScript && (!looksLikeJson || !hasUsefulTerms)) continue;
        payloads.push(body);
    }
    return payloads;
};

const tryParseJson = (value) => {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
};

const getFrequencyFromText = (value) => {
    const text = String(value ?? '').toLowerCase();
    if (/\b(monthly|month|mo)\b|\/\s*mo\b|\/\s*month\b/.test(text)) return 'monthly';
    if (/\b(annual|annually|yearly|year|yr)\b|\/\s*yr\b|\/\s*year\b/.test(text)) return 'annual';
    if (/\b(quarterly|quarter)\b/.test(text)) return 'quarterly';
    if (/\b(weekly|week)\b/.test(text)) return 'weekly';
    return '';
};

const toMonthlyAmount = (amount, frequency) => {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (frequency === 'annual') return amount / 12;
    if (frequency === 'quarterly') return amount / 3;
    if (frequency === 'weekly') return amount * 52 / 12;
    return amount;
};

const isTaxAmountKey = (key) => {
    const normalized = normalizeKey(key);
    if (!normalized.includes('tax')) return false;
    if (/rate|history|url|year|date|increase|assessment|assessed|value/.test(normalized)) return false;
    return /taxpaid|taxamount|taxes|propertytax|annualtax|tax$/.test(normalized);
};

const isHoaKey = (key) => {
    const normalized = normalizeKey(key);
    if (/associationfee|homeownersassociationfee|monthlyhoafee|hoafee|hoadues|hoaamount|monthlyhoa/.test(normalized)) return true;
    return normalized === 'hoa';
};

const isBedsKey = (key) => {
    const normalized = normalizeKey(key);
    return /^(bed|beds|bedroom|bedrooms|bedcount|bedroomcount|numbedrooms|numberofbedrooms|numberofbedroomstotal|br)$/.test(normalized);
};

const isBathsKey = (key) => {
    const normalized = normalizeKey(key);
    return /^(bath|baths|bathroom|bathrooms|bathcount|bathroomcount|numbathrooms|numberofbathrooms|numberofbathroomstotal|ba)$/.test(normalized);
};

const isSquareFeetKey = (key) => {
    const normalized = normalizeKey(key);
    return /(sqft|squarefeet|livingarea|floorsize|interiorarea|buildingarea|finishedarea|grosslivingarea|finishedsqft|heatedarea|livingspace|livingareavalue)$/.test(normalized);
};

const isLocationKey = (key) => {
    const normalized = normalizeKey(key);
    return /^(address|formattedaddress|fulladdress|displayaddress|location|propertyaddress|streetaddress|neighborhood|community|subdivision|county)$/.test(normalized);
};

const extractNumericFactValue = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') return parseMoney(value);
    if (!value || typeof value !== 'object') return 0;
    for (const key of ['value', 'amount', 'count', 'size', 'total', 'quantity', 'number']) {
        const parsed = parseMoney(value[key]);
        if (parsed > 0) return parsed;
    }
    return 0;
};

const buildLocationTextFromObject = (obj) => {
    if (!obj || typeof obj !== 'object') return '';

    const street = normalizeText(String(
        obj.streetAddress
        ?? obj.addressLine1
        ?? obj.line1
        ?? obj.address1
        ?? obj.street
        ?? obj.streetName
        ?? ''
    ).trim());
    const city = normalizeText(String(obj.addressLocality ?? obj.city ?? obj.locality ?? '').trim());
    const state = normalizeText(String(obj.addressRegion ?? obj.state ?? obj.region ?? '').trim());
    const postal = normalizeText(String(obj.postalCode ?? obj.zipCode ?? obj.zip ?? '').trim());
    const formatted = normalizeText(String(
        obj.formattedAddress
        ?? obj.formatted_address
        ?? obj.fullAddress
        ?? obj.displayAddress
        ?? obj.location
        ?? ''
    ).trim());

    const hasUsefulParts = Boolean(street || city || state || postal || formatted);
    if (!hasUsefulParts) return '';

    const pieces = [];
    if (street) pieces.push(street);
    const localityBase = [city, state].filter(Boolean).join(', ').trim();
    const locality = [localityBase, postal].filter(Boolean).join(' ').trim();
    if (locality) pieces.push(locality);
    if (!pieces.length) return formatted;
    return normalizeText(pieces.join(', '));
};

const selectNumericFact = (candidates, { min = 0, max = Infinity, transform = (value) => value } = {}) => {
    const valid = candidates
        .filter(candidate => Number.isFinite(candidate.value) && candidate.value >= min && candidate.value <= max)
        .sort((a, b) => b.score - a.score || a.order - b.order);
    const best = valid[0] ?? null;
    if (!best) {
        return {
            value: 0,
            found: false,
            sourcePath: ''
        };
    }
    return {
        value: transform(best.value),
        found: true,
        sourcePath: best.sourcePath
    };
};

const selectLocationFact = (candidates) => {
    const valid = candidates
        .filter(candidate => typeof candidate.value === 'string' && candidate.value.trim())
        .sort((a, b) => b.score - a.score || b.value.length - a.value.length || a.order - b.order);
    const best = valid[0] ?? null;
    if (!best) {
        return {
            value: '',
            found: false,
            sourcePath: ''
        };
    }
    return {
        value: best.value,
        found: true,
        sourcePath: best.sourcePath
    };
};

const PRICE_AMOUNT_MIN = 5000;
const PRICE_AMOUNT_MAX = 1000000000;

const isListingPriceKey = (key) => {
    const normalized = normalizeKey(key);
    return [
        'price',
        'listprice',
        'listingprice',
        'askingprice',
        'homeprice',
        'currentprice',
        'displayprice',
        'offerprice',
        'salesprice',
        'saleprice',
        'unformattedprice',
        'formattedprice'
    ].includes(normalized);
};

const scoreListingPriceCandidate = ({ key, value, path }) => {
    const amount = parseMoney(value);
    if (!Number.isFinite(amount) || amount < PRICE_AMOUNT_MIN || amount > PRICE_AMOUNT_MAX) return 0;

    const normalizedKey = normalizeKey(key);
    const normalizedPath = normalizeKey(Array.isArray(path) ? path.join(' ') : String(path ?? ''));
    const combined = `${normalizedKey} ${normalizedPath}`;

    if (/(history|tax|hoa|mortgage|payment|rent|insurance|estimate|zestimate|assessed|valuation|appraisal|sold|closed|pending|contingent)/.test(combined)) {
        return 0;
    }

    let score = 0;
    if (isListingPriceKey(key)) {
        score += 6;
    } else if (/price/.test(normalizedKey)) {
        score += 3;
    } else if ((normalizedKey === 'value' || normalizedKey === 'amount') && /price/.test(normalizedPath)) {
        score += 4;
    }

    if (/(offer|listing|list|home|property|detail|details|sale|market|forsale)/.test(normalizedPath)) {
        score += 2;
    }

    if (normalizedKey === 'price' && /^(property|home|offer|listing|details?|sale|market)/.test(normalizedPath)) {
        score += 1;
    }

    return score;
};

const collectHomePriceCandidate = (collector, key, value, path) => {
    const score = scoreListingPriceCandidate({ key, value, path });
    if (!score) return;

    const amount = parseMoney(value);
    if (!Number.isFinite(amount) || amount < PRICE_AMOUNT_MIN || amount > PRICE_AMOUNT_MAX) return;

    collector.homePriceCandidates.push({
        amount,
        score,
        sourcePath: [...path, key].join('.')
    });
};

const selectHomePrice = (candidates) => {
    const valid = candidates
        .filter(candidate => Number.isFinite(candidate.amount) && candidate.amount >= PRICE_AMOUNT_MIN && candidate.amount <= PRICE_AMOUNT_MAX)
        .sort((a, b) => b.score - a.score || b.amount - a.amount);
    const best = valid[0] ?? null;
    if (!best) {
        return {
            amount: 0,
            found: false,
            sourcePath: ''
        };
    }
    return {
        ...best,
        amount: best.amount,
        found: true
    };
};

const findYearInObject = (obj) => {
    for (const [key, value] of Object.entries(obj)) {
        const normalized = normalizeKey(key);
        if (/^(year|taxyear|assessmentyear)$/.test(normalized)) {
            const year = parseYear(value);
            if (year) return year;
        }
    }
    for (const [key, value] of Object.entries(obj)) {
        const normalized = normalizeKey(key);
        if (/^(time|date|taxdate)$/.test(normalized)) {
            const year = parseYear(value);
            if (year) return year;
        }
    }
    return 0;
};

const findTaxAmountInObject = (obj) => {
    let best = 0;
    for (const [key, value] of Object.entries(obj)) {
        if (!isTaxAmountKey(key)) continue;
        const amount = parseMoney(value);
        if (amount >= 50 && (!best || amount > best)) best = amount;
    }
    return best;
};

const findFrequencyInObject = (obj, ownKey, ownValue) => {
    const ownFrequency = getFrequencyFromText(`${ownKey} ${typeof ownValue === 'string' ? ownValue : ''}`);
    if (ownFrequency) return ownFrequency;
    for (const [key, value] of Object.entries(obj)) {
        if (!/frequency|period|interval|unit/i.test(key)) continue;
        const frequency = getFrequencyFromText(value);
        if (frequency) return frequency;
    }
    return '';
};

const collectFromJson = (value, collector, path = []) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectFromJson(item, collector, [...path, String(index)]));
        return;
    }

    const obj = value;
    const inferredLocation = buildLocationTextFromObject(obj);
    if (inferredLocation) {
        collector.locationCandidates.push({
            value: inferredLocation,
            sourcePath: path.join('.'),
            score: path.length === 0 ? 2 : 3,
            order: collector.factOrder++
        });
    }
    const year = findYearInObject(obj);
    const taxAmount = year ? findTaxAmountInObject(obj) : 0;
    if (year && taxAmount >= 50) {
        collector.taxRecords.push({
            amountAnnual: taxAmount,
            year,
            sourcePath: path.join('.')
        });
    }

    for (const [key, child] of Object.entries(obj)) {
        collectHomePriceCandidate(collector, key, child, path);
        if (isHoaKey(key)) {
            const amount = parseMoney(child);
            if (amount > 0) {
                const frequency = findFrequencyInObject(obj, key, child);
                collector.hoaCandidates.push({
                    amountMonthly: toMonthlyAmount(amount, frequency),
                    rawAmount: amount,
                    frequency: frequency || 'monthly',
                    sourcePath: [...path, key].join('.'),
                    score: normalizeKey(key).includes('monthly') ? 4 : 2
                });
            }
        }
        if (isBedsKey(key)) {
            const amount = extractNumericFactValue(child);
            if (amount > 0 && amount <= 20) {
                collector.bedCandidates.push({
                    value: amount,
                    sourcePath: [...path, key].join('.'),
                    score: normalizeKey(key) === 'bedrooms' || normalizeKey(key) === 'beds' ? 5 : 3,
                    order: collector.factOrder++
                });
            }
        }
        if (isBathsKey(key)) {
            const amount = extractNumericFactValue(child);
            if (amount > 0 && amount <= 20) {
                collector.bathCandidates.push({
                    value: amount,
                    sourcePath: [...path, key].join('.'),
                    score: normalizeKey(key) === 'bathrooms' || normalizeKey(key) === 'baths' ? 5 : 3,
                    order: collector.factOrder++
                });
            }
        }
        if (isSquareFeetKey(key)) {
            const amount = extractNumericFactValue(child);
            if (amount >= 100 && amount <= 200000) {
                collector.squareFeetCandidates.push({
                    value: amount,
                    sourcePath: [...path, key].join('.'),
                    score: normalizeKey(key).includes('livingarea') || normalizeKey(key).includes('squarefeet') ? 5 : 3,
                    order: collector.factOrder++
                });
            }
        }
        if (isLocationKey(key)) {
            const locationValue = typeof child === 'string'
                ? normalizeText(child)
                : buildLocationTextFromObject(child);
            if (locationValue) {
                collector.locationCandidates.push({
                    value: locationValue,
                    sourcePath: [...path, key].join('.'),
                    score: normalizeKey(key) === 'formattedaddress' || normalizeKey(key) === 'displayaddress' ? 6 : 4,
                    order: collector.factOrder++
                });
            }
        }
        collectFromJson(child, collector, [...path, key]);
    }
};

const collectFromText = (html, collector) => {
    const text = normalizeText(decodeHtmlEntities(String(html ?? ''))
        .replace(/\\"/g, '"')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '));

    const labeledTaxPatterns = [
        {
            pattern: /\bannual\s*tax\s*amount\b.{0,250}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?).{0,250}?\btax\s*year\b.{0,80}?\b((?:19|20|21)\d{2})\b/gi,
            yearIndex: 2,
            amountIndex: 1
        },
        {
            pattern: /\btax\s*year\b.{0,80}?\b((?:19|20|21)\d{2})\b.{0,250}?\bannual\s*tax\s*amount\b.{0,250}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
            yearIndex: 1,
            amountIndex: 2
        }
    ];
    labeledTaxPatterns.forEach(({ pattern, yearIndex, amountIndex }) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const year = parseYear(match[yearIndex]);
            const amountAnnual = parseMoney(match[amountIndex]);
            if (year && amountAnnual >= 50) {
                collector.taxRecords.push({ year, amountAnnual, sourcePath: 'visible text' });
            }
        }
    });

    const taxTablePatterns = [
        /\byear\s+(?:property\s*)?tax(?:es)?\b(.{0,2400})/gi,
        /\btax\s*history\b.{0,160}?\byear\s+(?:property\s*)?tax(?:es)?\b(.{0,2400})/gi
    ];
    taxTablePatterns.forEach((pattern) => {
        let tableMatch;
        while ((tableMatch = pattern.exec(text)) !== null) {
            const tableText = String(tableMatch[1] ?? '')
                .split(/\b(?:permit|nearby homes|nearby comparable homes|redfin estimate|home improvements|neighborhood|schools|monthly payment|price history|sale history|estimated home value|environmental risk)\b/i)[0];
            const rowPattern = /\b((?:19|20|21)\d{2})\b\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
            let rowMatch;
            while ((rowMatch = rowPattern.exec(tableText)) !== null) {
                const year = parseYear(rowMatch[1]);
                const amountAnnual = parseMoney(rowMatch[2]);
                if (year && amountAnnual >= 50) {
                    collector.taxRecords.push({ year, amountAnnual, sourcePath: 'visible text' });
                }
            }
        }
    });

    const taxPatterns = [
        /\b((?:19|20|21)\d{2})\b[^\$]{0,40}?\b(?:property\s*)?tax(?:es)?\b.{0,50}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
        /\b(?:property\s*)?tax(?:es)?\s*(?:for|in|year)?\s*\b((?:19|20|21)\d{2})\b.{0,40}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi
    ];
    taxPatterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const year = parseYear(match[1]);
            const amountAnnual = parseMoney(match[2]);
            if (year && amountAnnual >= 50) {
                collector.taxRecords.push({ year, amountAnnual, sourcePath: 'visible text' });
            }
        }
    });

    const hoaPatterns = [
        /\b(?:hoa|homeowners association|association fee|association dues)\b.{0,120}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*(?:\/|per)?\s*(mo|month|monthly|yr|year|annual|annually|quarter|quarterly))?/gi,
        /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?).{0,80}?\b(?:hoa|homeowners association|association fee|association dues)\b(?:.{0,40}?\b(mo|month|monthly|yr|year|annual|annually|quarter|quarterly)\b)?/gi
    ];
    hoaPatterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const rawAmount = parseMoney(match[1]);
            const frequency = getFrequencyFromText(match[2] ?? '') || 'monthly';
            const amountMonthly = toMonthlyAmount(rawAmount, frequency);
            if (frequency === 'monthly' && rawAmount > 3000) continue;
            if (amountMonthly > 0 && amountMonthly < 10000) {
                collector.hoaCandidates.push({
                    amountMonthly,
                    rawAmount,
                    frequency,
                    sourcePath: 'visible text',
                    score: frequency === 'monthly' ? 3 : 1
                });
            }
        }
    });

    const bedPatterns = [
        { pattern: /\b([0-9]{1,2}(?:\.[05])?)\s*(?:bd|bed|beds|bedroom|bedrooms)\b/gi, score: 4 },
        { pattern: /\b(?:bd|bed|beds|bedroom|bedrooms)\s*[:\-]?\s*([0-9]{1,2}(?:\.[05])?)\b/gi, score: 3 }
    ];
    bedPatterns.forEach(({ pattern, score }) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const amount = parseMoney(match[1]);
            if (amount > 0 && amount <= 20) {
                collector.bedCandidates.push({
                    value: amount,
                    sourcePath: 'visible text',
                    score,
                    order: collector.factOrder++
                });
            }
        }
    });

    const bathPatterns = [
        { pattern: /\b([0-9]{1,2}(?:\.[05])?)\s*(?:ba|bath|baths|bathroom|bathrooms)\b/gi, score: 4 },
        { pattern: /\b(?:ba|bath|baths|bathroom|bathrooms)\s*[:\-]?\s*([0-9]{1,2}(?:\.[05])?)\b/gi, score: 3 }
    ];
    bathPatterns.forEach(({ pattern, score }) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const amount = parseMoney(match[1]);
            if (amount > 0 && amount <= 20) {
                collector.bathCandidates.push({
                    value: amount,
                    sourcePath: 'visible text',
                    score,
                    order: collector.factOrder++
                });
            }
        }
    });

    const squareFeetPatterns = [
        { pattern: /\b([0-9][0-9,]{2,})\s*(?:sq\.?\s*ft|sqft|square\s+feet)\b/gi, score: 4 },
        { pattern: /\b(?:sq\.?\s*ft|sqft|square\s+feet)\s*[:\-]?\s*([0-9][0-9,]{2,})\b/gi, score: 3 }
    ];
    squareFeetPatterns.forEach(({ pattern, score }) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const amount = parseMoney(match[1]);
            if (amount >= 100 && amount <= 200000) {
                collector.squareFeetCandidates.push({
                    value: amount,
                    sourcePath: 'visible text',
                    score,
                    order: collector.factOrder++
                });
            }
        }
    });

    const locationPatterns = [
        { pattern: /\b([0-9]{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,6},\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)\b/g, score: 5 },
        { pattern: /\b([A-Za-z0-9.'-]+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)\b/g, score: 3 }
    ];
    locationPatterns.forEach(({ pattern, score }) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const locationValue = normalizeText(match[1]);
            if (!locationValue) continue;
            collector.locationCandidates.push({
                value: locationValue,
                sourcePath: 'visible text',
                score,
                order: collector.factOrder++
            });
        }
    });

    const homePricePatterns = [
        {
            pattern: /\b(?:listing price|list price|asking price|home price|current price)\b.{0,120}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
            score: 6,
            skipHistory: false
        },
        {
            pattern: /\b(?:listed(?:\s+at)?|for sale(?:\s+at)?|starting at)\b.{0,80}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
            score: 7,
            skipHistory: false
        },
        {
            pattern: /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?).{0,80}?\b(?:listing price|list price|asking price|home price|current price|for sale|listed)\b/gi,
            score: 5,
            skipHistory: true
        }
    ];
    homePricePatterns.forEach(({ pattern, score, skipHistory }) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const amount = parseMoney(match[1]);
            if (amount < PRICE_AMOUNT_MIN || amount > PRICE_AMOUNT_MAX) continue;
            const contextStart = Math.max(0, match.index - 80);
            const contextEnd = Math.min(text.length, match.index + match[0].length + 80);
            const context = text.slice(contextStart, contextEnd);
            if (skipHistory) {
                if (/(sold|closed|pending|contingent|hoa|assessment)/i.test(context)) continue;
                if (/history/i.test(context)) continue;
            }
            collector.homePriceCandidates.push({
                amount,
                score,
                sourcePath: 'visible text'
            });
        }
    });
};

const dedupeTaxRecords = (records) => {
    const byYear = new Map();
    records.forEach((record) => {
        const year = parseYear(record.year);
        const amountAnnual = Number(record.amountAnnual);
        if (!year || !Number.isFinite(amountAnnual) || amountAnnual < 50) return;
        const existing = byYear.get(year);
        if (!existing || amountAnnual > existing.amountAnnual) {
            byYear.set(year, { ...record, year, amountAnnual });
        }
    });
    return [...byYear.values()].sort((a, b) => b.year - a.year);
};

const selectLatestTax = (records, currentYear = CURRENT_YEAR()) => {
    const candidates = dedupeTaxRecords(records).filter(record => record.year <= currentYear);
    const latest = candidates[0] ?? null;
    if (!latest) return null;
    return {
        ...latest,
        isCurrentYear: latest.year === currentYear,
        currentYear,
        records: candidates.slice(0, 5)
    };
};

const selectHoa = (candidates) => {
    const valid = candidates
        .filter(candidate => Number.isFinite(candidate.amountMonthly) && candidate.amountMonthly > 0 && candidate.amountMonthly < 10000)
        .sort((a, b) => b.score - a.score || a.amountMonthly - b.amountMonthly);
    const best = valid[0] ?? null;
    if (!best) {
        return {
            amountMonthly: 0,
            found: false,
            frequency: 'monthly',
            sourcePath: ''
        };
    }
    return {
        ...best,
        amountMonthly: best.amountMonthly,
        found: true
    };
};

export const parseListingCostsFromHtml = (html, options = {}) => {
    const collector = {
        taxRecords: [],
        hoaCandidates: [],
        homePriceCandidates: [],
        bedCandidates: [],
        bathCandidates: [],
        squareFeetCandidates: [],
        locationCandidates: [],
        factOrder: 0
    };

    extractJsonScriptPayloads(html).forEach((payload) => {
        const parsed = tryParseJson(payload);
        if (parsed) collectFromJson(parsed, collector);
    });
    collectFromText(html, collector);

    return {
        tax: selectLatestTax(collector.taxRecords, options.currentYear ?? CURRENT_YEAR()),
        hoa: selectHoa(collector.hoaCandidates),
        homePrice: selectHomePrice(collector.homePriceCandidates),
        propertyFacts: {
            beds: selectNumericFact(collector.bedCandidates, { min: 0, max: 20 }),
            baths: selectNumericFact(collector.bathCandidates, { min: 0, max: 20 }),
            squareFeet: selectNumericFact(collector.squareFeetCandidates, {
                min: 100,
                max: 200000,
                transform: (value) => Math.round(value)
            }),
            location: selectLocationFact(collector.locationCandidates)
        }
    };
};
