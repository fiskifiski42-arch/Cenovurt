const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.CRON_SECRET = 'test-only-sample-secret-long-enough-2026';
const { issueToken } = require('../api/_auth');
const session = require('../api/session');

async function requestSession(method, authorization) {
  let status, body;
  const req = { method, headers: { authorization } };
  const res = {
    setHeader() {},
    set statusCode(value) { status = value; },
    end(value) { body = JSON.parse(value); },
  };
  await session(req, res);
  return { status, body };
}

test('stored session token recovers its email only when valid', async () => {
  const token = issueToken('Saved@Example.com');
  const good = await requestSession('GET', 'Bearer ' + token);
  assert.equal(good.status, 200);
  assert.equal(good.body.email, 'saved@example.com');
  const invalid = await requestSession('GET', 'Bearer ' + token + 'tampered');
  assert.equal(invalid.status, 401);
  assert.equal((await requestSession('POST', 'Bearer ' + token)).status, 405);
});

function browserFixture(sessionReply, initialEmail = '') {
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const token = issueToken('saved@example.com');
  const values = new Map([['cenovurt-session', token]]);
  if (initialEmail) values.set('cenovurt-email', initialEmail);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', hidden: false,
      addEventListener() {}, appendChild() {}, scrollIntoView() {},
    });
    return elements.get(id);
  };
  const requests = [];
  const fetch = async url => {
    requests.push(url);
    const payload = url === '/api/session' ? sessionReply :
      url.startsWith('/api/account?') ? { email: 'saved@example.com', plan: 'Free', used: 1, limit: 3, paid: false } :
      url.startsWith('/api/watches?') ? { watches: [{ id: 'a', url: 'https://example.com/item', targetPrice: 55 }] } : {};
    return {
      ok: !(url === '/api/session' && sessionReply.error),
      status: url === '/api/session' && sessionReply.error ? 401 : 200,
      json: async () => payload,
    };
  };
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const document = { getElementById: element, createElement: () => ({ className: '', textContent: '' }) };
  const context = { document, localStorage, fetch, URL, URLSearchParams, Intl, Date,
    location: { search: '', pathname: '/' }, history: { replaceState() {} } };
  vm.runInNewContext(script, context);
  return { elements, values, requests };
}

test('page refresh restores existing session and watches without another email code', async () => {
  const fixture = browserFixture({ ok: true, email: 'saved@example.com' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.elements.get('accountEmail').value, 'saved@example.com');
  assert.equal(fixture.elements.get('accountBox').hidden, false);
  assert.match(fixture.elements.get('list').innerHTML, /example\.com/);
  assert.equal(fixture.values.get('cenovurt-email'), 'saved@example.com');
  assert.deepEqual(fixture.requests.map(url => url.split('?')[0]),
    ['/api/session', '/api/account', '/api/watches']);
});

test('expired token is removed but email stays ready for one new verification', async () => {
  const fixture = browserFixture({ error: 'Сесията е изтекла.' }, 'saved@example.com');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.values.has('cenovurt-session'), false);
  assert.equal(fixture.elements.get('accountEmail').value, 'saved@example.com');
  assert.deepEqual(fixture.requests, ['/api/session']);
});
