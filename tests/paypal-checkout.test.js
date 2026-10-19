const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.CRON_SECRET = 'paypal-test-secret-12345678901234567890';
process.env.PAYPAL_MODE = 'sandbox';
process.env.PAYPAL_CLIENT_ID = 'sandbox-client-test';
process.env.PAYPAL_CLIENT_SECRET = 'sandbox-secret-test';

const lib = require('../api/_lib');
const { issueToken } = require('../api/_auth');
const state = new Map();
lib.redis = async (...args) => {
  const [cmd, key, value] = args;
  if (cmd === 'SET') { state.set(key, value); return 'OK'; }
  return null;
};
lib.getJSON = async key => JSON.parse(state.get(key) || 'null');
lib.setJSON = async (key, value) => { state.set(key, JSON.stringify(value)); };
lib.getAccount = async email => JSON.parse(state.get('account:' + email) || 'null');
lib.setAccount = async (email, value) => { state.set('account:' + email, JSON.stringify(value)); };

const create = require('../api/paypal-create');
const capture = require('../api/paypal-capture');
const orderId = '2K123456789012345';
const buyer = 'buyer@example.com';

function req(body, email = buyer) {
  return {
    method: 'POST', body,
    headers: { authorization: 'Bearer ' + issueToken(email) },
  };
}
function response() {
  return {
    statusCode: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(v) { this.value = JSON.parse(v); },
  };
}
function payPalReply(data) {
  return { ok: true, status: 200, json: async () => data };
}

test('PayPal sandbox: server creates fixed amount and activates only matching owner on completed capture', async t => {
  const savedFetch = global.fetch;
  const requested = [];
  t.after(() => { global.fetch = savedFetch; });
  global.fetch = async (url, options) => {
    requested.push([url, options]);
    if (url.endsWith('/v1/oauth2/token')) return payPalReply({ access_token: 'fake-oauth-token' });
    if (url.endsWith('/v2/checkout/orders') && options.method === 'POST') {
      return payPalReply({
        id: orderId, status: 'CREATED',
        links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId }],
      });
    }
    if (url.endsWith('/' + orderId + '/capture')) {
      return payPalReply({
        id: orderId, status: 'COMPLETED', purchase_units: [{
          payments: { captures: [{ status: 'COMPLETED', amount: { currency_code: 'EUR', value: '9.00' } }] },
        }],
      });
    }
    if (url.endsWith('/' + orderId)) {
      return payPalReply({
        id: orderId, status: 'COMPLETED', purchase_units: [{
          payments: { captures: [{ status: 'COMPLETED', amount: { currency_code: 'EUR', value: '9.00' } }] },
        }],
      });
    }
    throw new Error('Unexpected URL ' + url);
  };

  const made = response();
  await create(req({ email: buyer, plan: 'Basic' }), made);
  assert.equal(made.statusCode, 200);
  assert.match(made.value.url, /^https:\/\/www\.sandbox\.paypal\.com/);
  const body = JSON.parse(requested.find(([u]) => u.endsWith('/v2/checkout/orders'))[1].body);
  assert.equal(body.purchase_units[0].amount.value, '9.00');
  assert.equal(body.purchase_units[0].amount.currency_code, 'EUR');

  const stolen = response();
  await capture(req({ orderId }, 'attacker@example.com'), stolen);
  assert.equal(stolen.statusCode, 403);
  assert.equal(state.has('account:attacker@example.com'), false);

  const paid = response();
  await capture(req({ orderId }), paid);
  assert.equal(paid.statusCode, 200);
  assert.equal(paid.value.plan, 'Basic');
  assert.equal((await lib.getAccount(buyer)).plan, 'Basic');
  assert.equal(requested.filter(([u]) => u.endsWith('/capture')).length, 1);

  const repeated = response();
  await capture(req({ orderId }), repeated);
  assert.equal(repeated.statusCode, 200);
  assert.equal(requested.filter(([u]) => u.endsWith('/capture')).length, 1);
});

test('PayPal payment is disabled unless credentials exist', async () => {
  const saved = process.env.PAYPAL_CLIENT_SECRET;
  delete process.env.PAYPAL_CLIENT_SECRET;
  try {
    const res = response();
    await create(req({ email: buyer, plan: 'Pro' }), res);
    assert.equal(res.statusCode, 503);
    assert.match(res.value.error, /не е настроен/);
  } finally { process.env.PAYPAL_CLIENT_SECRET = saved; }
});
