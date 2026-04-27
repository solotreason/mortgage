import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, '..');

const MIME_TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.ico', 'image/x-icon']
]);

const toFilePath = (requestPath) => {
    const normalized = requestPath === '/' ? '/index.html' : requestPath;
    const safeRelative = path.normalize(decodeURIComponent(normalized)).replace(/^([/\\])+/, '');
    const absolute = path.resolve(PROJECT_ROOT, safeRelative);
    if (!absolute.startsWith(PROJECT_ROOT)) return null;
    return absolute;
};

const createStaticServer = () => createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const filePath = toFilePath(pathname);
        if (!filePath) {
            res.writeHead(403).end('Forbidden');
            return;
        }
        const content = await readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES.get(ext) ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType }).end(content);
    } catch (error) {
        res.writeHead(404).end('Not Found');
    }
});

let server;
let baseUrl;

test.beforeAll(async () => {
    server = createStaticServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
    if (!server) return;
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

test('print flow keeps interactive UI hidden and emits PDF', async ({ page }, testInfo) => {
    await page.goto(`${baseUrl}/index.html`);
    await page.waitForSelector('#tab-mortgage.active');

    // Exercise print-prep hooks with a popup open and page scrolled.
    await page.click('#openBreakdownPopupBtn');
    await expect(page.locator('#breakdownPopup')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(page.locator('#breakdownPopup')).toHaveClass(/hidden/);
    await expect(page.locator('#cashBreakdownDetails')).toHaveJSProperty('open', true);
    const scrollYAfterBeforePrint = await page.evaluate(() => window.scrollY);
    expect(scrollYAfterBeforePrint).toBe(0);
    await expect(page.locator('#printGeneratedAt')).not.toHaveText('Not generated');

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#cashBreakdownDetails')).toHaveJSProperty('open', false);

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#saveScenarioBtn')).toBeHidden();
    await expect(page.locator('#loadScenarioBtn')).toBeHidden();
    await expect(page.locator('#openBreakdownPopupBtn')).toBeHidden();
    await expect(page.locator('#openAmortizationPopupBtn')).toBeHidden();
    await expect(page.locator('footer.print-only')).toBeVisible();
    await expect(page.locator('footer.print-only')).toContainText('planning use only');

    const overflowMaxHeight = await page.locator('.overflow-x-auto').first().evaluate((el) => getComputedStyle(el).maxHeight);
    expect(overflowMaxHeight).toBe('none');

    const pdfBytes = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
    });
    expect(pdfBytes.byteLength).toBeGreaterThan(10_000);
    await testInfo.attach('print-output', { body: pdfBytes, contentType: 'application/pdf' });
});
