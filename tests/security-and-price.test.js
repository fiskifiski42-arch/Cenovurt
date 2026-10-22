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
