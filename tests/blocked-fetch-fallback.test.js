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
    assert.equal(args.get('mode'), 'auto');
    assert.equal(args.get('js_render'), null);
    assert.equal(args.get('premium_proxy'), null);
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

test('Amazon.de canonicalizes a marketing link and uses ZenRows after HTTP 503', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  const productUrl = 'https://www.amazon.de/Bowers-Wilkins-Noise-Cancelling/dp/B0FH5QDTBQ?pf_rd_p=old&ref_=tracking';
  const primaryPrice = '<html><div id="corePriceDisplay_desktop_feature_div">' +
    '<span class="a-price"><span class="a-offscreen">545,00 €</span></span></div></html>';
  const calls = [];
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    global.fetch = async requested => {
      const next = String(requested);
      calls.push(next);
      return next.startsWith('https://api.zenrows.com/') ? response(200, primaryPrice) : response(503);
    };
    assert.equal(await fetchProductPrice(productUrl), 545);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'https://www.amazon.de/dp/B0FH5QDTBQ');
    assert.equal(new URL(calls[1]).searchParams.get('url'), calls[0]);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('Amazon.co.uk recovers HTTP 503 and converts the confirmed GBP price', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  const productUrl = 'https://www.amazon.co.uk/ADAM-Audio-Studio-Monitor-Single/dp/B07BKVY3J1?pd_rd_w=tracking';
  const primaryPrice = '<html><div id="corePriceDisplay_desktop_feature_div">' +
    '<span class="a-price"><span class="a-offscreen">£169.00</span></span></div></html>';
  const calls = [];
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    global.fetch = async requested => {
      const next = String(requested);
      calls.push(next);
      if (next.startsWith('https://api.zenrows.com/')) return response(200, primaryPrice);
      if (next.startsWith('https://www.ecb.europa.eu/')) {
        return response(200, "<Cube currency='USD' rate='1.10'/><Cube currency='GBP' rate='0.80'/>", 'application/xml');
      }
      return response(503);
    };
    assert.equal(await fetchProductPrice(productUrl), 211.25);
    assert.equal(calls[0], 'https://www.amazon.co.uk/dp/B07BKVY3J1');
    assert.equal(new URL(calls[1]).searchParams.get('url'), calls[0]);
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
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

test('ZenRows text/plain containing genuine product HTML is accepted', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    let count = 0;
    global.fetch = async () => ++count === 1 ? response(403) : response(200, html, 'text/plain; charset=utf-8');
    assert.equal(await fetchProductPrice(url), 72.7);
    assert.equal(count, 2);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('ZenRows JSON wrapper with HTML can be parsed securely', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    let count = 0;
    global.fetch = async () => ++count === 1 ? response(403)
      : response(200, JSON.stringify({ html }), 'application/json');
    assert.equal(await fetchProductPrice(url), 72.7);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('ZenRows JSON API errors on HTTP 200 never turn into false prices', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    let count = 0;
    global.fetch = async () => ++count === 1 ? response(403)
      : response(200, JSON.stringify({ code: 'FETCH_ERROR', message: 'price EUR 1,00' }), 'application/json');
    await assert.rejects(fetchProductPrice(url), /ZenRows върна JSON вместо HTML.*FETCH_ERROR/);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('ZenRows text-only page without markup never guesses a price', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    let count = 0;
    global.fetch = async () => ++count === 1 ? response(403)
      : response(200, 'price 5,00 EUR', 'text/plain');
    await assert.rejects(fetchProductPrice(url), /не върна HTML съдържание/);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('ZenRows HTTP 422 exposes a safe provider code and never invents a price', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    const calls = [];
    global.fetch = async requested => {
      calls.push(String(requested));
      return calls.length === 1 ? response(403) : response(422,
        JSON.stringify({ code: 'RESP001', title: 'Target website did not respond' }),
        'application/json');
    };
    await assert.rejects(fetchProductPrice(url), /HTTP 422, код RESP001/);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1]).searchParams.get('mode'), 'auto');
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('temporary HTTP 500 and a network failure both reach one fallback request', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    for (const failure of [() => response(500), () => { throw new TypeError('fetch failed'); }]) {
      let count = 0;
      global.fetch = async () => ++count === 1 ? failure() : response(200, html);
      assert.equal(await fetchProductPrice(url), 72.7);
      assert.equal(count, 2);
    }
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('HTML CAPTCHA challenge triggers fallback, never a false price', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    const challenge = '<html><title>Just a moment</title><body><div class="cf-chl-widget">Checking</div></body></html>';
    let count = 0;
    global.fetch = async () => ++count === 1 ? response(200, challenge) : response(200, html);
    assert.equal(await fetchProductPrice(url), 72.7);
    assert.equal(count, 2);

    global.fetch = async () => response(200, challenge);
    await assert.rejects(fetchProductPrice(url), /страница за проверка на достъпа/);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});

test('hidden Amazon price returns its specific explanation instead of generic failure', async () => {
  const oldFetch = global.fetch, oldLookup = dns.lookup, oldKey = process.env.ZENROWS_API_KEY;
  try {
    dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }];
    process.env.ZENROWS_API_KEY = 'testing-zenrows-key';
    let count = 0;
    global.fetch = async () => {count++; return response(200,
      '<html><body>To see the product details, add this item to your basket</body></html>');};
    await assert.rejects(fetchProductPrice('https://www.amazon.de/dp/B0FH5QDTBQ'), /Amazon скрива продажната цена/);
    assert.equal(count, 1);
  } finally {
    global.fetch = oldFetch; dns.lookup = oldLookup;
    if (oldKey === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = oldKey;
  }
});
