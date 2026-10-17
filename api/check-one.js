const { json, parseBody, normalizeEmail, validEmail, getWatches, setWatches, fetchProductPrice } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    const id = String(body.id || '').trim();
    if (!validEmail(email) || !id) return json(res, 400, { error: 'Липсват email или наблюдение.' });
    const watches = await getWatches(email);
    const idx = watches.findIndex((w) => w.id === id);
    if (idx < 0) return json(res, 404, { error: 'Наблюдението не е намерено.' });
    try {
      const price = await fetchProductPrice(watches[idx].url);
      watches[idx].lastPrice = price;
      watches[idx].lastCheckedAt = new Date().toISOString();
      watches[idx].lastError = null;
      await setWatches(email, watches);
      return json(res, 200, { ok: true, price, targetPrice: watches[idx].targetPrice, hit: price <= watches[idx].targetPrice });
    } catch (err) {
      watches[idx].lastCheckedAt = new Date().toISOString();
      watches[idx].lastError = err.message;
      await setWatches(email, watches);
      return json(res, 422, { error: err.message });
    }
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
