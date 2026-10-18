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
function tokenEmail(req) {
  const header = String(req.headers?.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const parts = header.slice(7).split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const expected = signature(parts[0]);
  if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return validEmail(value.email) && Number(value.exp) > Date.now()
      ? normalizeEmail(value.email) : null;
  } catch { return null; }
}
function isOwner(req, email) { return tokenEmail(req) === normalizeEmail(email); }
function oneTimeHash(email, code) {
  return signature('otp:' + normalizeEmail(email) + ':' + String(code));
}
module.exports = { issueToken, tokenEmail, isOwner, oneTimeHash };
