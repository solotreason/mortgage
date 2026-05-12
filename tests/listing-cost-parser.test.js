import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getListingSourceFromUrl,
    parseListingCostsFromHtml
} from '../src/core/listing-cost-parser.js';

test('listing URL validation accepts Realtor hosts only', () => {
    assert.equal(getListingSourceFromUrl('https://www.realtor.com/realestateandhomes-detail/example')?.source, 'realtor');
    assert.equal(getListingSourceFromUrl('https://www.zillow.com/homedetails/example/123_zpid/'), null);
    assert.equal(getListingSourceFromUrl('https://example.com/listing'), null);
    assert.equal(getListingSourceFromUrl('ftp://www.zillow.com/homedetails/example'), null);
});

test('parser selects latest available tax year and monthly HOA from embedded JSON', () => {
    const html = `
        <script id="__NEXT_DATA__" type="application/json">
        {
            "props": {
                "pageProps": {
                    "property": {
                        "taxHistory": [
                            { "time": 1735689600000, "taxPaid": 6125 },
                            { "time": 1704067200000, "taxPaid": 5810 }
                        ],
                        "monthlyHoaFee": "$275/mo"
                    }
                }
            }
        }
        </script>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.tax.year, 2025);
    assert.equal(parsed.tax.amountAnnual, 6125);
    assert.equal(parsed.tax.isCurrentYear, false);
    assert.equal(parsed.tax.currentYear, 2026);
    assert.equal(parsed.hoa.found, true);
    assert.equal(parsed.hoa.amountMonthly, 275);
});

test('parser extracts a listing price from embedded JSON', () => {
    const html = `
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "SingleFamilyResidence",
            "offers": {
                "@type": "Offer",
                "price": 425000,
                "priceCurrency": "USD"
            },
            "taxHistory": [
                { "time": 1735689600000, "taxPaid": 6125 }
            ],
            "monthlyHoaFee": "$275/mo"
        }
        </script>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.homePrice.found, true);
    assert.equal(parsed.homePrice.amount, 425000);
    assert.match(parsed.homePrice.sourcePath, /offers.*price/);
    assert.equal(parsed.tax.amountAnnual, 6125);
    assert.equal(parsed.hoa.amountMonthly, 275);
});

test('parser extracts a listing price from application/json without tax or HOA terms', () => {
    const html = `
        <script type="application/json">
        {
            "listing": {
                "details": {
                    "price": 525000,
                    "currency": "USD"
                }
            }
        }
        </script>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.homePrice.found, true);
    assert.equal(parsed.homePrice.amount, 525000);
    assert.match(parsed.homePrice.sourcePath, /listing.*details.*price/);
    assert.equal(parsed.tax, null);
    assert.equal(parsed.hoa.found, false);
});

test('parser extracts property facts from embedded JSON', () => {
    const html = `
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "SingleFamilyResidence",
            "offers": {
                "@type": "Offer",
                "price": 425000,
                "priceCurrency": "USD"
            },
            "numberOfBedrooms": 3,
            "numberOfBathroomsTotal": 2.5,
            "floorSize": {
                "@type": "QuantitativeValue",
                "value": 1842,
                "unitText": "SQFT"
            },
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "1069 Aronimink Dr",
                "addressLocality": "Calera",
                "addressRegion": "AL",
                "postalCode": "35040"
            }
        }
        </script>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.propertyFacts.beds.found, true);
    assert.equal(parsed.propertyFacts.beds.value, 3);
    assert.equal(parsed.propertyFacts.baths.found, true);
    assert.equal(parsed.propertyFacts.baths.value, 2.5);
    assert.equal(parsed.propertyFacts.squareFeet.found, true);
    assert.equal(parsed.propertyFacts.squareFeet.value, 1842);
    assert.equal(parsed.propertyFacts.location.found, true);
    assert.equal(parsed.propertyFacts.location.value, '1069 Aronimink Dr, Calera, AL 35040');
});

test('parser defaults HOA to zero when no HOA amount is available', () => {
    const html = `
        <script type="application/ld+json">
        {
            "name": "Example listing",
            "tax": { "taxYear": 2026, "taxAmount": "$4,320" }
        }
        </script>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.tax.year, 2026);
    assert.equal(parsed.tax.amountAnnual, 4320);
    assert.equal(parsed.tax.isCurrentYear, true);
    assert.equal(parsed.hoa.found, false);
    assert.equal(parsed.hoa.amountMonthly, 0);
});

test('parser can use compact visible Realtor-style tax history text', () => {
    const html = `
        <section>
            <h3>Tax History</h3>
            Year Taxes Total assessment equals Land added to Additions
            2025$5,249$335,367=-+-
            2024$4,741$335,367=-+-
        </section>
        <p>HOA fees are not listed.</p>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.tax.year, 2025);
    assert.equal(parsed.tax.amountAnnual, 5249);
    assert.equal(parsed.tax.isCurrentYear, false);
    assert.equal(parsed.hoa.found, false);
    assert.equal(parsed.hoa.amountMonthly, 0);
});

test('parser prefers tax table rows over nearby sale prices', () => {
    const html = `
        <main>
            <section>
                Financial Tax Information Annual Tax Amount: $10,907 Tax Year: 2025
            </section>
            <section>
                Sale and tax history for 6451 Pershing St Sale History Tax History
                Date Event Price May 5, 2026 Listed $469,900
                Show more Year Property tax Land + Additions Assessment*
                2025 $10,907 (-3.8%) $57,240 + $415,650 $472,890
                2024 $11,343 (+8.5%) $57,240 + $415,650 $472,890
                Permit history
                Nearby comparable homes SOLD APR 28, 2026 $455,000
            </section>
        </main>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.tax.year, 2025);
    assert.equal(parsed.tax.amountAnnual, 10907);
    assert.equal(parsed.tax.isCurrentYear, false);
    assert.equal(parsed.homePrice.found, true);
    assert.equal(parsed.homePrice.amount, 469900);
});

test('parser extracts listing data from search-snippet style visible text', () => {
    const html = `
        <section>
            1069 Aronimink Dr Calera AL 35040 Realtor listing price $374,900
            Annual Tax Amount: $2,191 Tax Year: 2024 HOA assessment $12/mo
        </section>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.homePrice.found, true);
    assert.equal(parsed.homePrice.amount, 374900);
    assert.equal(parsed.tax.year, 2024);
    assert.equal(parsed.tax.amountAnnual, 2191);
    assert.equal(parsed.hoa.found, true);
    assert.equal(parsed.hoa.amountMonthly, 12);
});

test('parser extracts property facts from visible listing text', () => {
    const html = `
        <section>
            1069 Aronimink Dr, Calera, AL 35040
            3 bed 2.5 bath 1,842 sq ft
        </section>
    `;

    const parsed = parseListingCostsFromHtml(html, { currentYear: 2026 });

    assert.equal(parsed.propertyFacts.beds.found, true);
    assert.equal(parsed.propertyFacts.beds.value, 3);
    assert.equal(parsed.propertyFacts.baths.found, true);
    assert.equal(parsed.propertyFacts.baths.value, 2.5);
    assert.equal(parsed.propertyFacts.squareFeet.found, true);
    assert.equal(parsed.propertyFacts.squareFeet.value, 1842);
    assert.equal(parsed.propertyFacts.location.found, true);
    assert.equal(parsed.propertyFacts.location.value, '1069 Aronimink Dr, Calera, AL 35040');
});
