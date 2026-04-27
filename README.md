# MortgagePro Suite

A browser-based mortgage analysis tool with four calculators:

- Mortgage payment and amortization
- Affordability
- Rent vs. buy (10-year net-cost model)
- Refinance break-even and cost comparison
- Save/load scenario controls (browser local storage)

## Run

This project is static HTML/CSS/JS. Open `index.html` in a browser.

To export a report, use your browser print flow (`Ctrl+P` on Windows/Linux or `Cmd+P` on macOS) and choose **Save to PDF**.
Use `Save Scenario` / `Load Scenario` in the header to preserve and restore all inputs before export.

## Files

- `index.html`: UI layout and inputs
- `styles.css`: shared styling
- `app.js`: UI orchestration and chart rendering
- `src/core/mortgage-core.js`: reusable mortgage calculation engine (pure functions)
- `src/ui/mortgage-ui.js`: mortgage calculator module
- `src/ui/afford-ui.js`: affordability calculator module
- `src/ui/rentbuy-ui.js`: rent-vs-buy calculator module
- `src/ui/refinance-ui.js`: refinance calculator module

## Quality Checks

- `npm run check`: syntax + static smoke checks
- `npm run smoke`: static UI/entrypoint smoke checks
- `npm run test`: unit tests for the core calculation module
- `npm run test:print`: Playwright print regression test (Chromium)
- `npm run ci`: full local CI pass (`check` + `test`)

GitHub Actions runs `npm run ci` for every push and pull request.

## Notes

- All calculations are estimates for planning and educational use.
- Verify tax, insurance, and loan assumptions with a licensed professional.

## Security

- CDN assets are version-pinned with Subresource Integrity (SRI).
- CSP and browser security policy meta tags are in `index.html`.
- Host-level security headers are defined in `_headers` (Netlify-style syntax).
- Deployment hardening examples (HTTPS redirect, disable directory listing, staging/prod separation) are in `DEPLOYMENT_SECURITY.md`.
