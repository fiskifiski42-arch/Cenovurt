const { test } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const { fetchProductPrice } = require('../api/_lib');

const response = (status, html = '', type = 'text/html') => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: name => name.toLowerCase() === 'content-type' ? type : null },
  text: async () => html,
});

const html = '<meta property="product:price:amount" content="72,70"><meta property="product:price:currency" content="EUR">';
const url = 'https://www.technopolis.bg/bg/Konsumativi/TONER-BROTHER-TN248-MAGENTA/p/503594?utm_source=chatgpt.com';

test('HTTP 403 uses paid-provider fallback only when a key is configured', async () => {
  const previousFetch = global.fetch;
  const previousLookup = dns.lookup;
  const previousKey = process.env.ZENROWS_API_KEY;
  const calls = [];
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    global.fetch = async requested => {
      calls.push(String(requested));
      return calls.length === 1 ? response(403) : response(200, html);
    };
    assert.equal(await fetchProductPrice(url), 72.7);
    assert.equal(calls.length, 2);
    assert.ok(!calls[0].includes('utm_source'));
    assert.ok(calls[1].startsWith('https://api.zenrows.com/v1/'));
    const args = new URL(calls[1]).searchParams;
    assert.equal(args.get('js_render'), 'true');
    assert.equal(args.get('premium_proxy'), 'true');
    assert.ok(!args.get('url').includes('utm_source'));
  } finally {
    global.fetch = previousFetch;
    dns.lookup = previousLookup;
    if (previousKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = previousKey;
  }
});

test('a normal direct result does not spend provider credits', async () => {
  const previousFetch = global.fetch;
  const previousLookup = dns.lookup;
  const previousKey = process.env.ZENROWS_API_KEY;
  let count = 0;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    global.fetch = async () => { count++; return response(200, html); };
    assert.equal(await fetchProductPrice(url), 72.7);
    assert.equal(count, 1);
  } finally {
    global.fetch = previousFetch;
    dns.lookup = previousLookup;
    if (previousKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = previousKey;
  }
});

test('a blocked website without a provider key reports actionable error', async () => {
  const previousFetch = global.fetch;
  const previousLookup = dns.lookup;
  const previousKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    delete process.env.ZENROWS_API_KEY;
    global.fetch = async () => response(403);
    await assert.rejects(fetchProductPrice(url), /ZENROWS_API_KEY/);
  } finally {
    global.fetch = previousFetch;
    dns.lookup = previousLookup;
    if (previousKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = previousKey;
  }
});

test('a provider challenge with no verified price never invents a price', async () => {
  const previousFetch = global.fetch;
  const previousLookup = dns.lookup;
  const previousKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    let count = 0;
    global.fetch = async () => ++count === 1 ? response(403) : response(200, '<html>Verify you are human</html>');
    await assert.rejects(fetchProductPrice(url), /Не открих надеждна цена/);
  } finally {
    global.fetch = previousFetch;
    dns.lookup = previousLookup;
    if (previousKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = previousKey;
  }
});
