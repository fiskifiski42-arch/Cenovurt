const { isOwner } = require('./_auth');
const { json, parseBody, normalizeEmail, validEmail, getWatches, setWatches, redis } = require('./_lib');
const { allowIpRequest } = require('./_rate-limit');
const { processWatch } = require('./check');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    const id = String(body.id || '').trim();
    if (!validEmail(email) || !id) return json(res, 400, { error: 'Липсват email или наблюдение.' });
    if (!isOwner(req, email)) return json(res, 401, { error: 'Първо потвърди имейла си с код.' });
    const watches = await getWatches(email);
    const watch = watches.find((w) => w.id === id);
    if (!watch) return json(res, 404, { error: 'Наблюдението не е намерено.' });
    if (!await allowIpRequest(req, 'check-one', 200, 600)) return json(res, 429, { error: 'Твърде много ръчни проверки. Изчакай малко.' });
    const lockKey = 'cenovurt:manual-check:' + email + ':' + id;
    if (!await redis('SET', lockKey, '1', 'EX', '20', 'NX')) return json(res, 429, { error: 'Изчакай 20 секунди преди нова проверка на този продукт.' });

    const result = await processWatch(email, watch);
    const latest = await getWatches(email);
    if (latest.some((w) => w.id === id)) {
      await setWatches(email, latest.map((w) =>
        w.id === id ? { ...w, ...result.updated } : w
      ));
    }
    if (!result.ok) return json(res, 422, { error: result.updated.lastError });
    return json(res, 200, {
      ok: true,
      price: result.updated.lastPrice,
      targetPrice: watch.targetPrice,
      hit: result.updated.lastPrice <= watch.targetPrice,
      notified: result.notified
    });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
