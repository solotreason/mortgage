import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const SERIES_IDS = ['MORTGAGE30US', 'MORTGAGE15US'];
const FRED_CSV_ENDPOINTS_BY_SERIES = (seriesId) => ([
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
    `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}/downloaddata/${encodeURIComponent(seriesId)}.csv`
]);

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

const fetchLatestObservation = async (seriesId) => {
    let lastError = null;
    for (const endpoint of FRED_CSV_ENDPOINTS_BY_SERIES(seriesId)) {
        try {
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const observation = parseLatestObservationFromFredCsv(await response.text());
            if (!observation) throw new Error(`No observation for ${seriesId}`);
            return observation;
        } catch (error) {
            lastError = error;
        }
    }
    throw (lastError ?? new Error(`Unable to fetch ${seriesId}`));
};

const seriesEntries = await Promise.all(SERIES_IDS.map(async (seriesId) => [
    seriesId,
    await fetchLatestObservation(seriesId)
]));

const payload = {
    updatedAt: new Date().toISOString(),
    source: 'FRED',
    series: Object.fromEntries(seriesEntries)
};

const outputPath = path.join(projectRoot, 'data', 'live-rates.json');
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Updated ${path.relative(projectRoot, outputPath)} from FRED.`);
