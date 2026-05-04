import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const PORT = Number.parseInt(process.env.PORT ?? '4173', 10);
const ROOT_DIR = process.cwd();
const SERIES_ALLOWLIST = new Set(['MORTGAGE30US', 'MORTGAGE15US']);

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

        await serveStaticAsset(req, res, requestUrl.pathname);
    } catch (error) {
        sendText(res, 500, 'Server Error');
    }
});

server.listen(PORT, () => {
    console.log(`Mortgage dev server running at http://localhost:${PORT}`);
});
