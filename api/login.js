const crypto = require('node:crypto');
const { json, parseBody, validEmail, normalizeEmail, redis, sendEmail } = require('./_lib');
const { oneTimeHash } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return json(res, 400, { error: 'Въведи валиден имейл.' });
    const rateKey = 'cenovurt:login:rate:' + email;
    const allowed = await redis('SET', rateKey, '1', 'EX', '60', 'NX');
    if (!allowed) return json(res, 429, { error: 'Код вече е изпратен. Опитай след минута.' });
    const code = String(crypto.randomInt(100000, 1000000));
    const otpKey = 'cenovurt:login:otp:' + email;
    await redis('SET', otpKey, oneTimeHash(email, code), 'EX', '600');
    try {
      await sendEmail({
        to: email,
        subject: 'Ценовърт – код за вход',
        html: '<div style="font-family:Arial,sans-serif"><h2>Твоят код за Ценовърт</h2>' +
          '<p style="font-size:32px;font-weight:bold;letter-spacing:5px">' + code + '</p>' +
          '<p>Валиден е 10 минути. Ако не си поискал кода, игнорирай имейла.</p></div>'
      });
    } catch (e) {
      await redis('DEL', otpKey);
      await redis('DEL', rateKey);
      throw e;
    }
    return json(res, 200, { ok: true, message: 'Изпратих 6-цифрен код на имейла ти.' });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
