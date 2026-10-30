const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.CRON_SECRET = 'test-only-sample-secret-long-enough-2026';
const { issueToken, tokenEmail, sessionCookie } = require('../api/_auth');
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

function browserFixture(sessionReply, initialEmail = '', initialSession = true) {
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const token = issueToken('saved@example.com');
  const values = new Map(initialSession ? [['cenovurt-session', token]] : []);
  if (initialEmail) values.set('cenovurt-email', initialEmail);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', hidden: false,
      addEventListener(type, handler) { (this.listeners ||= {})[type] = handler; },
      appendChild() {}, scrollIntoView() {},
    });
    return elements.get(id);
  };
  const requests = [];
  const fetch = async url => {
    requests.push(url);
    const sessionDenied = url === '/api/session' && (sessionReply.error || (!initialSession && !sessionReply.email));
    const payload = url === '/api/session' ? (sessionDenied ? {error:'unauthorized'} : sessionReply) :
      url.startsWith('/api/account?') ? { email: 'saved@example.com', plan: 'Free', used: 1, limit: 3, paid: false } :
      url.startsWith('/api/watches?') ? { watches: [{ id: 'a', url: 'https://example.com/item', targetPrice: 55 }] } : {};
    return {
      ok: !sessionDenied,
      status: sessionDenied ? 401 : 200,
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
  return { elements, values, requests, context };
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

test('logout clears this device and does not expose the previous user watches', async () => {
  const fixture = browserFixture({ email: 'saved@example.com' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.elements.get('loggedInBox').hidden, false);
  assert.equal(fixture.elements.get('signedInEmail').textContent, 'saved@example.com');
  fixture.context.logout();
  assert.equal(fixture.values.has('cenovurt-session'), false);
  assert.equal(fixture.values.has('cenovurt-email'), false);
  assert.equal(fixture.elements.get('accountEmail').value, '');
  assert.equal(fixture.elements.get('loginFields').hidden, false);
  assert.equal(fixture.elements.get('loggedInBox').hidden, true);
  assert.equal(fixture.elements.get('demoStartBox').hidden, false);
  assert.doesNotMatch(fixture.elements.get('list').innerHTML, /example\.com\/item/);
  assert.deepEqual(fixture.requests.map(url => url.split('?')[0]), ['/api/session', '/api/account', '/api/watches', '/api/logout']);
});

test('email-free demo uses illustrative local-only watches, no server calls', async () => {
  const fixture = browserFixture({}, '', false);
  await new Promise(resolve => setImmediate(resolve));
  fixture.context.startDemo();
  assert.equal(fixture.elements.get('demoBox').hidden, false);
  assert.equal(fixture.elements.get('loginFields').hidden, true);
  assert.match(fixture.elements.get('list').innerHTML, /Демо · не е реална цена/);
  fixture.context.demoCheckOne('demo-example');
  assert.match(fixture.elements.get('list').innerHTML, /Симулирана цена/);
  fixture.context.document.getElementById('url').value = 'https://shop.example.org/headphones';
  fixture.context.document.getElementById('price').value = '89,90';
  await fixture.elements.get('watchForm').listeners.submit({
    preventDefault() {},
    target: { reset() {} },
  });
  assert.match(fixture.elements.get('list').innerHTML, /shop\.example\.org/);
  assert.deepEqual(fixture.requests, ['/api/session']);
  fixture.context.exitDemo();
  assert.equal(fixture.elements.get('demoBox').hidden, true);
  assert.doesNotMatch(fixture.elements.get('list').innerHTML, /Симулирана цена/);
  assert.deepEqual(fixture.requests, ['/api/session']);
});

test('HttpOnly cookie authenticates without a browser-readable token', () => {
  const signed = issueToken('cookie@example.com');
  const cookie = sessionCookie(signed).split(';')[0];
  assert.equal(tokenEmail({method:'GET',headers:{cookie}}), 'cookie@example.com');
  assert.equal(tokenEmail({method:'POST',headers:{cookie,host:'cenovurt.vercel.app',origin:'https://evil.example'}}), null);
  assert.equal(tokenEmail({method:'POST',headers:{cookie,host:'cenovurt.vercel.app',origin:'https://cenovurt.vercel.app'}}), 'cookie@example.com');
  assert.equal(tokenEmail({method:'GET',headers:{cookie:cookie+'tampered'}}), null);
});

test('refresh restores a cookie-only session without putting it in localStorage', async () => {
  const fixture = browserFixture({ok:true,email:'saved@example.com'},'',false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.elements.get('accountBox').hidden, false);
  assert.equal(fixture.values.has('cenovurt-session'),false);
  assert.deepEqual(fixture.requests.map(url=>url.split('?')[0]),['/api/session','/api/account','/api/watches']);
});
