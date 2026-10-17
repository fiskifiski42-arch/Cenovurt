const { json, parseBody, normalizeEmail, validEmail, getAccount, redis, sendEmail, escapeHtml } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return json(res, 400, { error: 'Невалиден email.' });
    const account = await getAccount(email);
    if (!account?.plan) return json(res, 402, { error: 'Няма активен платен пакет.' });

    const key = `cenovurt:test:${email}`;
    const last = Number(await redis('GET', key) || 0);
    const day = 24 * 60 * 60 * 1000;
    if (Date.now() - last < day) {
      const hours = Math.max(1, Math.ceil((day - (Date.now() - last)) / 3600000));
      return json(res, 429, { error: `Тестов сигнал вече е изпращан. Опитай след около ${hours} ч.` });
    }

    await sendEmail({
      to: email,
      subject: 'Ценовърт – тестов сигнал',
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
        <h2>Тестът работи ✅</h2>
        <p>Това е реален тестов email от <strong>Ценовърт</strong>.</p>
        <p>Когато наблюдаван продукт падне под зададената от теб прагова цена, ще получиш сигнал на този адрес.</p>
        <p style="color:#667085;font-size:13px">План: ${escapeHtml(account.plan)} · лимит: ${account.limit} продукта</p>
      </div>`,
    });
    await redis('SET', key, String(Date.now()));
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
