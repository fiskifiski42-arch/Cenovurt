const crypto = require('node:crypto');
const { normalizeEmail, validEmail } = require('./_lib');

function secret() {
  const key = process.env.AUTH_SECRET || process.env.CRON_SECRET;
  if (!key || key.length < 20) {
    const e = new Error('Не е настроена защитата на профилите (AUTH_SECRET или CRON_SECRET).');
    e.code = 'MISSING_ENV';
    throw e;
  }
  return key;
}
function signature(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('hex');
}
function issueToken(email) {
  const address = normalizeEmail(email);
  if (!validEmail(address)) throw new Error('Невалиден имейл.');
  const payload = Buffer.from(JSON.stringify({
    email: address, exp: Date.now() + 7 * 24 * 3600000
  })).toString('base64url');
  return payload + '.' + signature(payload);
}
const SESSION_COOKIE = '__Host-cenovurt-session';
function sessionCookie(token) {
  return SESSION_COOKIE + '=' + encodeURIComponent(token) +
    '; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax';
}
function clearSessionCookie() {
  return SESSION_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}
function sameOrigin(req) {
  const origin = String(req.headers?.origin || '');
  const host = String(req.headers?.host || '');
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}
function verifiedTokenEmail(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const expected = signature(parts[0]);
  if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return validEmail(value.email) && Number(value.exp) > Date.now()
      ? normalizeEmail(value.email) : null;
  } catch { return null; }
}
function tokenEmail(req) {
  const header = String(req.headers?.authorization || '');
  if (header.startsWith('Bearer ')) {
    const email = verifiedTokenEmail(header.slice(7));
    if (email) return email; // One-time migration of older client sessions.
  }
  const rawCookies = String(req.headers?.cookie || '').split(';');
  const item = rawCookies.map(x => x.trim()).find(x => x.startsWith(SESSION_COOKIE + '='));
  if (!item) return null;
  if (!['GET', 'HEAD'].includes(String(req.method || '').toUpperCase()) && !sameOrigin(req)) {
    return null; // Cookie-authenticated mutations require an exact same-origin request.
  }
  try { return verifiedTokenEmail(decodeURIComponent(item.slice(SESSION_COOKIE.length + 1))); }
  catch { return null; }
}
function isOwner(req, email) { return tokenEmail(req) === normalizeEmail(email); }
function oneTimeHash(email, code) {
  return signature('otp:' + normalizeEmail(email) + ':' + String(code));
}
module.exports = { issueToken, tokenEmail, isOwner, oneTimeHash, sessionCookie, clearSessionCookie, sameOrigin };
