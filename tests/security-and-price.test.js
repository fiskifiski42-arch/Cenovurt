const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.CRON_SECRET = 'test-only-sample-secret-long-enough-2026';
const { extractPrice, validUrl } = require('../api/_lib');
const { issueToken, tokenEmail, isOwner } = require('../api/_auth');

test('product price from meta in both BGN and EUR', () => {
  assert.equal(extractPrice('<meta property="product:price:amount" content="2.499,95">'), 2499.95);
  assert.equal(extractPrice('<meta content="195,58" property="product:price:amount"><meta property="product:price:currency" content="BGN">'), 100);
});
test('product price from Product JSON-LD', () => {
  const html = '<script type="application/ld+json">{"@type":"Product","offers":{"price":"139.99","priceCurrency":"EUR"}}</script>';
  assert.equal(extractPrice(html), 139.99);
});
test('do not mistake shipping numbers for product price', () => {
  assert.equal(extractPrice('<div>Shipping €9.99</div>'), null);
});
test('Praktiker selects the active product price instead of crossed-out price', () => {
  const html = '<div class="product-store-prices__item"><span class="product-price product-price--old"><span class="product-price__value">172.90</span></span><span class="product-price"><span class="product-price__value">146.96</span></span></div>';
  assert.equal(extractPrice(html, 'https://praktiker.bg/bg/Konvektori/item/p/695843'), 146.96);
});

test('Praktiker refuses an old price when no current price is present', () => {
  const html = '<div class="product-store-prices__item"><span class="product-price product-price--old"><span class="product-price__value">172.90</span></span></div>';
  assert.equal(extractPrice(html, 'https://praktiker.bg/bg/Konvektori/item/p/695843'), null);
});

test('Amazon ignores prices in frequently bought together recommendations', () => {
  const html = '<div id="p13n-desktop-sims-fbt_DetailPage_0"><span class="a-price"><span class="a-offscreen">221,35 €</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0DWFMD52T'), null);
});

test('Amazon can extract a verified price-to-pay element', () => {
  const html = '<div id="corePriceDisplay_desktop_feature_div"><span class="priceToPay"><span class="a-offscreen">249,00 €</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0DWFMD52T'), 249);
});

test('Amazon reads current desktop price without priceToPay and ignores struck-through prices', () => {
  const html = '<div id="corePriceDisplay_desktop_feature_div">' +
    '<span class="a-price a-text-price"><span class="a-offscreen">349,00 €</span></span>' +
    '<span class="a-price aok-align-center"><span class="a-offscreen">249,00 €</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0DWFMD52T'), 249);
});

test('Amazon reads a mobile price widget with a deeper price-to-pay wrapper', () => {
  const html = '<div id="corePriceDisplay_mobile_feature_div"><span class="priceToPay">' +
    '<span class="a-size-small"></span>'.repeat(35) +
    '<span class="a-price"><span class="a-offscreen">129,99 €</span></span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0DWFMD52T'), 129.99);
});

test('Amazon can read euro cents when the primary price lacks a-offscreen', () => {
  const html = '<div id="corePrice_feature_div"><span class="a-price">' +
    '<span class="a-price-symbol">€</span><span class="a-price-whole">1.299' +
    '<span class="a-price-decimal">,</span></span>' +
    '<span class="a-price-fraction">95</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0DWFMD52T'), 1299.95);
});

test('Amazon.com reads USD buy-box prices only with a verified USD/EUR rate', () => {
  const html = '<div id="corePriceDisplay_desktop_feature_div">' +
    '<span class="a-price a-text-price"><span class="a-offscreen">$349.00</span></span>' +
    '<span class="a-price"><span class="a-offscreen">$299.00</span></span></div>';
  const link = 'https://www.amazon.com/dp/B0HF8P2DWG';
  assert.equal(extractPrice(html, link), null);
  assert.equal(extractPrice(html, link, { USD: 1.12 }), 266.96);
});

test('Amazon.com converts USD Product JSON-LD without confusing it with EUR', () => {
  const html = '<script type="application/ld+json">' +
    '{"@type":"Product","offers":{"price":"112.00","priceCurrency":"USD"}}</script>';
  assert.equal(extractPrice(html, 'https://www.amazon.com/dp/B0HF8P2DWG'), null);
  assert.equal(extractPrice(html, 'https://www.amazon.com/dp/B0HF8P2DWG', { USD: 1.12 }), 100);
});

test('Amazon.com does not assume an unlabelled dollar product price is EUR', () => {
  const html = '<meta property="product:price:amount" content="299.00">';
  assert.equal(extractPrice(html, 'https://www.amazon.com/dp/B0HF8P2DWG'), null);
  assert.equal(extractPrice(html, 'https://www.amazon.com/dp/B0HF8P2DWG', { USD: 1.12 }), null);
});

test('Amazon.co.uk converts primary GBP prices to EUR and rejects missing rates', () => {
  const html = '<div id="corePriceDisplay_desktop_feature_div">' +
    '<span class="a-price a-text-price"><span class="a-offscreen">£199.00</span></span>' +
    '<span class="a-price"><span class="a-offscreen">£169.00</span></span></div>';
  const link = 'https://www.amazon.co.uk/dp/B0HF8P2DWG';
  assert.equal(extractPrice(html, link), null);
  assert.equal(extractPrice(html, link, { GBP: 0.84 }), 201.19);
});

test('Amazon.com refuses unrelated recommendations even with a USD/EUR rate', () => {
  const html = '<div id="p13n-desktop-sims-fbt_DetailPage_0"><span class="a-price">' +
    '<span class="a-offscreen">$19.99</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.com/dp/B0HF8P2DWG', { USD: 1.12 }), null);
});

test('Amazon does not read an unrelated offer when the primary price is missing', () => {
  const html = '<div id="p13n-desktop-sims-fbt_DetailPage_0">' +
    '<span class="a-price"><span class="a-offscreen">19,99 €</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0DWFMD52T'), null);
});

test('extracts explicit microdata product prices without relying on domain', () => {
  const html = '<meta itemprop="priceCurrency" content="EUR"><span itemprop="price" content="99.95"></span>';
  assert.equal(extractPrice(html, 'https://example.com/products/item'), 99.95);
});

test('reject local, numeric and unusual URLs', () => {
  assert.equal(validUrl('http://127.0.0.1/admin'), false);
  assert.equal(validUrl('http://localhost:3000'), false);
  assert.equal(validUrl('http://192.168.1.1/router'), false);
  assert.equal(validUrl('file:///etc/passwd'), false);
  assert.equal(validUrl('https://example.com/product'), true);
});
test('verified session cannot be used for another email', () => {
  const token = issueToken('Customer@Example.com');
  const req = { headers: { authorization: 'Bearer ' + token } };
  assert.equal(tokenEmail(req), 'customer@example.com');
  assert.equal(isOwner(req, 'customer@example.com'), true);
  assert.equal(isOwner(req, 'other@example.com'), false);
  req.headers.authorization += 'changed';
  assert.equal(tokenEmail(req), null);
});


test('Amazon.de reads the current product New-from offer when the buy box is empty', () => {
  const html = '<html><input id="ASIN" value="B0FH5QDTBQ">' +
    '<div id="corePriceDisplay_desktop_feature_div">priceNotAvailable</div>' +
    '<div id="aod-ingress"><a id="aod-ingress-link">Neu (3) ab ' +
    '<span class="a-price"><span class="a-offscreen">504,38 €</span></span></a></div></html>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0FH5QDTBQ'), 504.38);
});

test('Amazon.co.uk reads a same-product New-from offer in pounds using a confirmed exchange rate', () => {
  const html = '<html><input id="ASIN" value="B07BKVY3J1">' +
    '<div id="aod-ingress">New (3) from ' +
    '<span class="a-price a-text-price"><span class="a-offscreen">£169.00</span></span>' +
    '<span class="a-price"><span class="a-offscreen">£149.00</span></span></div></html>';
  const url = 'https://www.amazon.co.uk/dp/B07BKVY3J1';
  assert.equal(extractPrice(html, url), null);
  assert.equal(extractPrice(html, url, { GBP: 0.80 }), 186.25);
});

test('Amazon main price always wins over another seller offer', () => {
  const html = '<input id="ASIN" value="B0FH5QDTBQ">' +
    '<div id="corePriceDisplay_desktop_feature_div">' +
    '<span class="a-price"><span class="a-offscreen">619,99 €</span></span></div>' +
    '<div id="aod-ingress">Neu (2) ab ' +
    '<span class="a-price"><span class="a-offscreen">504,38 €</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.de/dp/B0FH5QDTBQ'), 619.99);
});

test('Amazon rejects unrelated ASIN and unrelated recommendation prices', () => {
  const url = 'https://www.amazon.de/dp/B0FH5QDTBQ';
  const other = '<input id="ASIN" value="B07BKVY3J1">' +
    '<div id="aod-ingress">Neu (3) ab ' +
    '<span class="a-price"><span class="a-offscreen">29,95 €</span></span></div>';
  assert.equal(extractPrice(other, url), null);
  const recommended = '<input id="ASIN" value="B0FH5QDTBQ">' +
    '<div id="p13n-desktop-sims-fbt_DetailPage_0">Neu (3) ab ' +
    '<span class="a-price"><span class="a-offscreen">99,95 €</span></span></div>';
  assert.equal(extractPrice(recommended, url), null);
});

test('Amazon does not accept an AOD offer from a page without verified product identity', () => {
  const html = '<div id="aod-ingress">New (3) from ' +
    '<span class="a-price"><span class="a-offscreen">£99.00</span></span></div>';
  assert.equal(extractPrice(html, 'https://www.amazon.co.uk/dp/B07BKVY3J1', { GBP: 0.85 }), null);
});
