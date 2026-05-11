import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const indexPath = path.join(projectRoot, 'index.html');
const appPath = path.join(projectRoot, 'app.js');
const corePath = path.join(projectRoot, 'src', 'core', 'mortgage-core.js');

assert.ok(fs.existsSync(indexPath), 'Missing index.html');
assert.ok(fs.existsSync(appPath), 'Missing app.js');
assert.ok(fs.existsSync(corePath), 'Missing src/core/mortgage-core.js');

const indexHtml = fs.readFileSync(indexPath, 'utf8');
assert.match(indexHtml, /<script\s+type="module"\s+src="app\.js"><\/script>/, 'App entrypoint must use module script');

const requiredIds = [
    'content-mortgage',
    'content-afford',
    'content-rentbuy',
    'content-refinance',
    'tab-mortgage',
    'tab-afford',
    'tab-rentbuy',
    'tab-refinance',
    'propertyListingUrl',
    'loanToValue',
    'ltvDisplay'
];

requiredIds.forEach((id) => {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `Missing required UI id: ${id}`);
});

console.log('Static smoke checks passed.');
