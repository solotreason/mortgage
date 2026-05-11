import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {
    getListingSourceFromUrl,
    parseListingCostsFromHtml
} from '../src/core/listing-cost-parser.js';

const PORT = Number.parseInt(process.env.PORT ?? '63343', 10);
const ROOT_DIR = process.cwd();
const SERIES_ALLOWLIST = new Set(['MORTGAGE30US', 'MORTGAGE15US']);
const LISTING_FETCH_TIMEOUT_MS = 18000;
const LISTING_FETCH_MAX_REDIRECTS = 3;
const LISTING_SEARCH_TIMEOUT_MS = 10000;
const PUBLIC_LISTING_MATCH_TIMEOUT_MS = 14000;
const PUBLIC_LISTING_MATCH_HOSTS = new Set(['redfin.com']);
const BROWSER_HTML_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};
const DEFAULT_HOA = Object.freeze({
    amountMonthly: 0,
    found: false,
    frequency: 'monthly',
    sourcePath: ''
});
const DEFAULT_HOME_PRICE = Object.freeze({
    amount: 0,
    found: false,
    sourcePath: ''
});
const SEARCH_ENGINES = Object.freeze([
    {
        name: 'bing',
        buildUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`
    },
    {
        name: 'yahoo',
        buildUrl: (query) => `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`
    },
    {
        name: 'brave',
        buildUrl: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`
    }
]);
const SEARCH_ENGINE_BY_NAME = new Map(SEARCH_ENGINES.map((engine) => [engine.name, engine]));

const MIME_TYPES = {
    '.css': 'text/css; charset=UTF-8',
    '.html': 'text/html; charset=UTF-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.mjs': 'text/javascript; charset=UTF-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=UTF-8',
    '.txt': 'text/plain; charset=UTF-8'
};

const parseLatestObservationFromFredCsv = (csvText) => {
    const lines = String(csvText ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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

const fetchLatestRateFromFred = async (seriesId) => {
    const endpoints = [
        `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
        `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}/downloaddata/${encodeURIComponent(seriesId)}.csv`
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const csvText = await response.text();
            const parsed = parseLatestObservationFromFredCsv(csvText);
            if (!parsed) throw new Error('No parseable observations');
            return parsed;
        } catch (error) {
            lastError = error;
        }
    }

    throw (lastError ?? new Error('FRED fetch failed'));
};

const fetchListingHtml = async (targetUrl, redirectCount = 0) => {
    const sourceInfo = getListingSourceFromUrl(targetUrl);
    if (!sourceInfo) throw new Error('unsupported-listing-url');

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), LISTING_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(sourceInfo.url, {
            headers: BROWSER_HTML_HEADERS,
            redirect: 'manual',
            signal: controller.signal
        });

        if (response.status >= 300 && response.status < 400) {
            if (redirectCount >= LISTING_FETCH_MAX_REDIRECTS) throw new Error('listing-redirect-limit');
            const location = response.headers.get('location');
            if (!location) throw new Error('listing-redirect-missing-location');
            const nextUrl = new URL(location, sourceInfo.url).toString();
            if (!getListingSourceFromUrl(nextUrl)) throw new Error('listing-redirect-unsupported-host');
            return await fetchListingHtml(nextUrl, redirectCount + 1);
        }

        if (!response.ok) throw new Error(`listing-http-${response.status}`);
        return {
            html: await response.text(),
            sourceInfo
        };
    } finally {
        clearTimeout(timeoutHandle);
    }
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

const fetchTextWithTimeout = async (url, timeoutMs) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: BROWSER_HTML_HEADERS,
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`http-${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timeoutHandle);
    }
};

const extractAddressTermsFromListingUrl = (sourceInfo) => {
    const parsed = new URL(sourceInfo.url);
    const segments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    let slug = '';

    if (sourceInfo.source === 'realtor') {
        const detailIndex = segments.indexOf('realestateandhomes-detail');
        slug = segments[detailIndex + 1] ?? segments.at(-1) ?? '';
        slug = slug.replace(/_M[0-9-]+$/i, '');
    }

    return slug
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const getRegistrableHost = (url) => {
    try {
        const parts = new URL(url).hostname.toLowerCase().split('.').filter(Boolean);
        return parts.slice(-2).join('.');
    } catch (error) {
        return '';
    }
};

const extractUrlsFromSearchHtml = (html) => {
    const urls = [];
    const seen = new Set();
    const hrefRe = /\bhref=(["'])(.*?)\1/gi;
    let match;
    while ((match = hrefRe.exec(String(html ?? ''))) !== null) {
        const rawHref = decodeHtmlEntities(match[2]);
        let parsed;
        try {
            parsed = new URL(rawHref.startsWith('//') ? `https:${rawHref}` : rawHref, 'https://duckduckgo.com');
        } catch (error) {
            continue;
        }

        let targetUrl = parsed;
        if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
            const uddg = parsed.searchParams.get('uddg');
            if (!uddg) continue;
            try {
                targetUrl = new URL(uddg);
            } catch (error) {
                continue;
            }
        }

        if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') continue;
        const normalized = targetUrl.toString();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        urls.push(normalized);
    }
    return urls;
};

const isPublicListingMatchUrl = (url) => {
    const host = getRegistrableHost(url);
    if (!PUBLIC_LISTING_MATCH_HOSTS.has(host)) return false;
    try {
        const parsed = new URL(url);
        return parsed.pathname.includes('/home/');
    } catch (error) {
        return false;
    }
};

const getAddressMatchParts = (sourceInfo) => {
    const tokens = extractAddressTermsFromListingUrl(sourceInfo).toLowerCase().split(/\s+/).filter(Boolean);
    const streetNumber = tokens.find(token => /^\d+[a-z]?$/.test(token)) ?? '';
    const zipCode = [...tokens].reverse().find(token => /^\d{5}(?:-\d{4})?$/.test(token))?.slice(0, 5) ?? '';
    const streetName = tokens.find((token, index) => {
        if (index === 0 || !/^[a-z]+$/.test(token)) return false;
        return !new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'pl', 'place', 'blvd', 'boulevard', 'fl']).has(token);
    }) ?? '';
    return { streetNumber, streetName, zipCode };
};

const isMatchingPublicListingUrl = (url, sourceInfo) => {
    if (!isPublicListingMatchUrl(url)) return false;
    const { streetNumber, streetName, zipCode } = getAddressMatchParts(sourceInfo);
    const pathText = new URL(url).pathname.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    if (streetNumber && !new RegExp(`\\b${streetNumber}\\b`).test(pathText)) return false;
    if (streetName && !new RegExp(`\\b${streetName}\\b`).test(pathText)) return false;
    if (zipCode && !new RegExp(`\\b${zipCode}\\b`).test(pathText)) return false;
    return true;
};

const buildPublicListingSearchQueries = (sourceInfo) => {
    const terms = extractAddressTermsFromListingUrl(sourceInfo);
    if (!terms) return [];
    return [
        `"${terms}" Redfin`,
        `"${terms}" Redfin "Annual Tax Amount" "Tax Year"`,
        `"${terms}" "Property tax" "Tax History" Redfin`,
        `${terms} Redfin property tax HOA`
    ];
};

const buildPublicListingSearchUrls = (query) => [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}`
];

const buildSearchSnippetQueries = (sourceInfo, field) => {
    const terms = extractAddressTermsFromListingUrl(sourceInfo);
    if (!terms) return [];
    if (field === 'homePrice') {
        return [
            `"${terms}" Realtor`,
            `"${terms}" Realtor listing price`,
            `"${terms}" Realtor home price`
        ];
    }
    if (field === 'tax') {
        return [
            `"${terms}" Realtor tax history`,
            `"${terms}" Realtor taxes`,
            `"${terms}" Realtor property tax`,
            `"${terms}" Realtor annual tax amount`
        ];
    }
    return [];
};

const buildSearchSnippetUrls = (query, engineNames) => engineNames.map((engineName) => {
    const engine = SEARCH_ENGINE_BY_NAME.get(engineName);
    if (!engine) return null;
    return {
        dataSource: `${engine.name}-search-snippet`,
        url: engine.buildUrl(query)
    };
}).filter(Boolean);

const hasListingCosts = (costs) => Boolean(costs?.tax || costs?.hoa?.found || costs?.homePrice?.found);

const mergePartialListingCosts = (primaryCosts, fallbackCosts) => ({
    tax: primaryCosts?.tax ?? fallbackCosts?.tax ?? null,
    hoa: primaryCosts?.hoa?.found ? primaryCosts.hoa : (fallbackCosts?.hoa?.found ? fallbackCosts.hoa : (primaryCosts?.hoa ?? fallbackCosts?.hoa ?? DEFAULT_HOA)),
    homePrice: primaryCosts?.homePrice?.found ? primaryCosts.homePrice : (fallbackCosts?.homePrice?.found ? fallbackCosts.homePrice : (primaryCosts?.homePrice ?? fallbackCosts?.homePrice ?? DEFAULT_HOME_PRICE))
});

const getSearchFieldValue = (parsedCosts, field) => {
    if (field === 'tax') return parsedCosts?.tax ?? null;
    if (field === 'hoa') return parsedCosts?.hoa?.found ? parsedCosts.hoa : null;
    if (field === 'homePrice') return parsedCosts?.homePrice?.found ? parsedCosts.homePrice : null;
    return null;
};

const setSearchFieldValue = (costs, field, value) => {
    if (field === 'tax') {
        costs.tax = value;
        return;
    }
    if (field === 'hoa') {
        costs.hoa = value ?? DEFAULT_HOA;
        return;
    }
    if (field === 'homePrice') {
        costs.homePrice = value ?? DEFAULT_HOME_PRICE;
    }
};

const hasSearchFieldValue = (costs, field) => {
    if (field === 'tax') return Boolean(costs?.tax);
    if (field === 'hoa') return Boolean(costs?.hoa?.found);
    if (field === 'homePrice') return Boolean(costs?.homePrice?.found);
    return false;
};

const findSearchSnippetMatchCosts = async (sourceInfo) => {
    let costs = {
        tax: null,
        hoa: DEFAULT_HOA,
        homePrice: DEFAULT_HOME_PRICE
    };
    let dataSource = '';
    let dataUrl = '';

    const fieldSearchPlan = [
        { field: 'homePrice', engines: ['bing', 'yahoo', 'brave'] },
        { field: 'tax', engines: ['yahoo', 'bing', 'brave'] }
    ];

    for (const { field, engines } of fieldSearchPlan) {
        if (hasSearchFieldValue(costs, field)) continue;
        const queries = buildSearchSnippetQueries(sourceInfo, field);
        for (const query of queries) {
            for (const candidate of buildSearchSnippetUrls(query, engines)) {
                let searchHtml = '';
                try {
                    searchHtml = await fetchTextWithTimeout(candidate.url, LISTING_SEARCH_TIMEOUT_MS);
                } catch (error) {
                    continue;
                }

                const parsedCosts = parseListingCostsFromHtml(searchHtml);
                const fieldValue = getSearchFieldValue(parsedCosts, field);
                if (!fieldValue) continue;

                setSearchFieldValue(costs, field, fieldValue);
                dataSource = candidate.dataSource;
                dataUrl = candidate.url;
                break;
            }
            if (hasSearchFieldValue(costs, field)) break;
        }
    }

    if (!hasListingCosts(costs)) return null;
    return {
        costs,
        dataSource: dataSource || 'search-snippet',
        dataUrl
    };
};

const findPublicListingMatchCosts = async (sourceInfo) => {
    const fetchedUrls = new Set();
    for (const query of buildPublicListingSearchQueries(sourceInfo)) {
        for (const searchUrl of buildPublicListingSearchUrls(query)) {
            let searchHtml = '';
            try {
                searchHtml = await fetchTextWithTimeout(searchUrl, LISTING_SEARCH_TIMEOUT_MS);
            } catch (error) {
                continue;
            }

            const candidates = extractUrlsFromSearchHtml(searchHtml)
                .filter(candidateUrl => isMatchingPublicListingUrl(candidateUrl, sourceInfo))
                .slice(0, 8);
            for (const candidateUrl of candidates) {
                if (fetchedUrls.has(candidateUrl)) continue;
                fetchedUrls.add(candidateUrl);
                try {
                    const html = await fetchTextWithTimeout(candidateUrl, PUBLIC_LISTING_MATCH_TIMEOUT_MS);
                    const costs = parseListingCostsFromHtml(html);
                    if (costs.tax || costs.hoa.found || costs.homePrice?.found) {
                        return {
                            costs,
                            dataSource: getRegistrableHost(candidateUrl),
                            dataUrl: candidateUrl
                        };
                    }
                } catch (error) {
                    // Try the next indexed match.
                }
            }
        }
    }
    return null;
};

const mergeListingCosts = (primaryCosts, fallbackCosts) => {
    const primaryHoa = primaryCosts?.hoa;
    const fallbackHoa = fallbackCosts?.hoa;
    const primaryHomePrice = primaryCosts?.homePrice;
    const fallbackHomePrice = fallbackCosts?.homePrice;
    return {
        tax: primaryCosts?.tax ?? fallbackCosts?.tax ?? null,
        hoa: primaryHoa?.found ? primaryHoa : (fallbackHoa?.found ? fallbackHoa : (primaryHoa ?? fallbackHoa ?? DEFAULT_HOA)),
        homePrice: primaryHomePrice?.found ? primaryHomePrice : (fallbackHomePrice?.found ? fallbackHomePrice : (primaryHomePrice ?? fallbackHomePrice ?? DEFAULT_HOME_PRICE))
    };
};

const fetchListingCosts = async (rawUrl) => {
    const sourceInfo = getListingSourceFromUrl(rawUrl);
    if (!sourceInfo) throw new Error('unsupported-listing-url');
    let directCosts = null;
    let directError = null;

    try {
        const { html } = await fetchListingHtml(sourceInfo.url);
        directCosts = parseListingCostsFromHtml(html);
    } catch (error) {
        directError = error;
    }

    const needsFallback = !directCosts?.tax || !directCosts?.hoa?.found || !directCosts?.homePrice?.found;
    const searchFallback = needsFallback ? await findSearchSnippetMatchCosts(sourceInfo) : null;
    const costs = mergeListingCosts(directCosts, searchFallback?.costs);

    return {
        source: sourceInfo.source,
        url: sourceInfo.url,
        tax: costs.tax,
        hoa: costs.hoa,
        homePrice: costs.homePrice,
        dataSource: searchFallback?.dataSource ?? sourceInfo.source,
        dataUrl: searchFallback?.dataUrl ?? sourceInfo.url,
        warning: searchFallback ? 'used-search-snippet-match' : (directError ? 'listing-source-blocked' : undefined)
    };
};

const sendJson = (res, statusCode, payload) => {
    res.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=UTF-8'
    });
    res.end(JSON.stringify(payload));
};

const sendText = (res, statusCode, text) => {
    res.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=UTF-8'
    });
    res.end(text);
};

const serveStaticAsset = async (req, res, pathname) => {
    const decodedPath = decodeURIComponent(pathname);
    const requestPath = decodedPath === '/' ? '/index.html' : decodedPath;
    const normalized = path.normalize(requestPath).replace(/^([/\\])+/, '');
    const absolutePath = path.resolve(ROOT_DIR, normalized);
    if (!absolutePath.startsWith(ROOT_DIR)) {
        sendText(res, 403, 'Forbidden');
        return;
    }

    let candidatePath = absolutePath;
    let candidateStat = await stat(candidatePath).catch(() => null);
    if (candidateStat && candidateStat.isDirectory()) {
        candidatePath = path.join(candidatePath, 'index.html');
        candidateStat = await stat(candidatePath).catch(() => null);
    }

    if (!candidateStat || !candidateStat.isFile()) {
        sendText(res, 404, 'Not Found');
        return;
    }

    const extension = path.extname(candidatePath).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
    res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': String(candidateStat.size),
        'Content-Type': contentType
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    createReadStream(candidatePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`);
        if (requestUrl.pathname === '/api/live-rate') {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                sendText(res, 405, 'Method Not Allowed');
                return;
            }
            const seriesId = String(requestUrl.searchParams.get('series') ?? 'MORTGAGE30US').toUpperCase();
            if (!SERIES_ALLOWLIST.has(seriesId)) {
                sendJson(res, 400, { error: 'unsupported-series' });
                return;
            }
            try {
                const latest = await fetchLatestRateFromFred(seriesId);
                sendJson(res, 200, { seriesId, date: latest.date, rate: latest.rate });
            } catch (error) {
                sendJson(res, 502, { error: 'live-rate-unavailable' });
            }
            return;
        }

        if (requestUrl.pathname === '/api/listing-costs') {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                sendText(res, 405, 'Method Not Allowed');
                return;
            }
            const listingUrl = String(requestUrl.searchParams.get('url') ?? '').trim();
            if (!getListingSourceFromUrl(listingUrl)) {
                sendJson(res, 400, { error: 'unsupported-listing-url' });
                return;
            }
            try {
                const costs = await fetchListingCosts(listingUrl);
                sendJson(res, 200, costs);
            } catch (error) {
                sendJson(res, 502, { error: 'listing-costs-unavailable' });
            }
            return;
        }

        await serveStaticAsset(req, res, requestUrl.pathname);
    } catch (error) {
        sendText(res, 500, 'Server Error');
    }
});

server.listen(PORT, () => {
    console.log(`Mortgage dev server running at http://localhost:${PORT}`);
});
