# MortgagePro Suite

A browser-based mortgage analysis tool with four calculators:

- Mortgage payment and amortization
- Affordability
- Rent vs. buy (10-year net-cost model)
- Refinance break-even and cost comparison

## Run

This project is static HTML/CSS/JS. Open `index.html` in a browser.

## Files

- `index.html`: UI layout and inputs
- `styles.css`: shared styling
- `app.js`: calculator logic and charts

## Notes

- All calculations are estimates for planning and educational use.
- Verify tax, insurance, and loan assumptions with a licensed professional.

## Security

- CDN assets are version-pinned with Subresource Integrity (SRI).
- CSP and browser security policy meta tags are in `index.html`.
- Host-level security headers are defined in `_headers` (Netlify-style syntax).
- Deployment hardening examples (HTTPS redirect, disable directory listing, staging/prod separation) are in `DEPLOYMENT_SECURITY.md`.
