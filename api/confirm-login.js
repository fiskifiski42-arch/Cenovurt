const crypto = require('node:crypto');
const { json, parseBody, validEmail, normalizeEmail, redis } = require('./_lib');
const { issueToken, oneTimeHash, sessionCookie, sameOrigin } = require('./_auth');
const { allowIpRequest } = require('./_rate-limit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.headers?.origin && !sameOrigin(req)) return json(res, 403, { error: 'Forbidden origin' });
  try {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    if (!validEmail(email) || !/^[0-9]{6}$/.test(code)) {
      return json(res, 400, { error: 'Въведи имейл и 6-цифрен код.' });
    }
    if (!await allowIpRequest(req, 'confirm-login', 35, 600)) return json(res, 429, { error: 'Твърде много опити за вход. Опитай по-късно.' });
    const key = 'cenovurt:login:otp:' + email;
    const triesKey = 'cenovurt:login:tries:' + email;
    const tries = Number(await redis('INCR', triesKey));
    if (tries === 1) await redis('EXPIRE', triesKey, '600');
    if (tries > 5) return json(res, 429, { error: 'Твърде много опити. Поискай нов код по-късно.' });
    const stored = await redis('GET', key);
    const candidate = oneTimeHash(email, code);
    if (!stored || !/^[a-f0-9]{64}$/.test(stored) ||
        !crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(candidate))) {
      return json(res, 401, { error: 'Грешен или изтекъл код.' });
    }
    await redis('DEL', key);
    await redis('DEL', triesKey);
    res.setHeader('Set-Cookie', sessionCookie(issueToken(email)));
    return json(res, 200, { ok: true, email });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
