const {
  json, parseBody, normalizeEmail, validEmail, validUrl,
  getAccount, getWatches, setWatches, randomId,
} = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const email = normalizeEmail(req.query?.email);
      if (!validEmail(email)) return json(res, 400, { error: 'Невалиден email.' });
      const watches = await getWatches(email);
      return json(res, 200, { watches });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const email = normalizeEmail(body.email);
      const url = String(body.url || '').trim();
      const targetPrice = Number(String(body.targetPrice || '').replace(',', '.'));
      if (!validEmail(email)) return json(res, 400, { error: 'Невалиден email.' });
      if (!validUrl(url)) return json(res, 400, { error: 'Постави пълен http/https линк.' });
      if (!Number.isFinite(targetPrice) || targetPrice <= 0) return json(res, 400, { error: 'Невалидна прагова цена.' });

      const account = await getAccount(email);
      if (!account?.plan) return json(res, 402, { error: 'Първо избери и плати пакет.' });
      const watches = await getWatches(email);
      if (watches.length >= account.limit) {
        return json(res, 409, { error: `Достигнат е лимитът на пакет ${account.plan}: ${account.limit} продукта.` });
      }
      const item = {
        id: randomId(), url, targetPrice, email,
        createdAt: new Date().toISOString(),
        lastPrice: null, lastCheckedAt: null, lastError: null,
        lastNotifiedPrice: null, lastNotifiedAt: null,
      };
      watches.unshift(item);
      await setWatches(email, watches);
      return json(res, 201, { watch: item, used: watches.length, limit: account.limit });
    }

    if (req.method === 'DELETE') {
      const email = normalizeEmail(req.query?.email);
      const id = String(req.query?.id || '').trim();
      if (!validEmail(email) || !id) return json(res, 400, { error: 'Липсват email или id.' });
      const watches = await getWatches(email);
      const next = watches.filter((w) => w.id !== id);
      await setWatches(email, next);
      return json(res, 200, { ok: true, used: next.length });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
