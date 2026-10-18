const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.CRON_SECRET = 'test-only-sample-secret-long-enough-2026';
const lib = require('../api/_lib');
const { issueToken } = require('../api/_auth');
const email = 'manual@example.com';
let price = 20;
let sent = 0;
let watches = [{
  id: 'test-watch', email, url: 'https://example.com/product',
  targetPrice: 30, lastNotifiedAt: null, lastNotifiedPrice: null
}];
lib.getWatches = async () => watches;
lib.setWatches = async (_, next) => { watches = next; };
lib.fetchProductPrice = async () => price;
lib.sendEmail = async () => { sent++; return { id: 'mock' }; };
const manualCheck = require('../api/check-one');

async function runCheck() {
  let status;
  let data;
  const req = {
    method: 'POST',
    body: { email, id: 'test-watch' },
    headers: { authorization: 'Bearer ' + issueToken(email) }
  };
  const res = {
    setHeader() {},
    set statusCode(value) { status = value; },
    end(text) { data = JSON.parse(text); }
  };
  await manualCheck(req, res);
  return { status, data };
}

test('manual check sends notification and deduplicates it', async () => {
  const first = await runCheck();
  assert.equal(first.status, 200);
  assert.equal(first.data.hit, true);
  assert.equal(first.data.notified, true);
  assert.equal(sent, 1);
  const second = await runCheck();
  assert.equal(second.status, 200);
  assert.equal(second.data.notified, false);
  assert.equal(sent, 1);
});
test('manual check rejects unverified access', async () => {
  let status, data;
  await manualCheck({ method: 'POST', body: { email, id: 'test-watch' }, headers:{} }, {
    setHeader() {},
    set statusCode(value) { status = value; },
    end(value) { data = JSON.parse(value); }
  });
  assert.equal(status, 401);
  assert.match(data.error, /потвърди/);
});
