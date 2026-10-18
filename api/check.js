const { json, redis, getWatches, setWatches, fetchProductPrice, sendEmail, escapeHtml } = require('./_lib');

async function processWatch(email, watch) {
  const updated = { ...watch, lastCheckedAt: new Date().toISOString(), lastError: null };
  try {
    const price = await fetchProductPrice(watch.url);
    updated.lastPrice = price;
    const shouldNotify = price <= watch.targetPrice && (
      !watch.lastNotifiedAt || watch.lastNotifiedPrice !== price || Date.now() - new Date(watch.lastNotifiedAt).getTime() > 24 * 3600000
    );
    if (shouldNotify) {
      await sendEmail({
        to: email,
        subject: `Ценовърт: цената падна до €${price.toFixed(2)}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033">
          <h2>Цената падна под твоя праг 🔔</h2>
          <p>Текуща цена: <strong>€${price.toFixed(2)}</strong></p>
          <p>Твоят праг: <strong>€${Number(watch.targetPrice).toFixed(2)}</strong></p>
          <p><a href="${escapeHtml(watch.url)}" style="display:inline-block;background:#172033;color:white;text-decoration:none;padding:12px 18px;border-radius:10px">Отвори продукта</a></p>
          <p style="color:#667085;font-size:12px;overflow-wrap:anywhere">${escapeHtml(watch.url)}</p>
        </div>`,
      });
      updated.lastNotifiedAt = new Date().toISOString();
      updated.lastNotifiedPrice = price;
    }
    return { updated, ok: true, notified: shouldNotify };
  } catch (e) {
    updated.lastError = e.message;
    return { updated, ok: false, notified: false };
  }
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  try {
    const auth = String(req.headers.authorization || '');
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    const emails = await redis('SMEMBERS', 'cenovurt:emails') || [];
    let checked = 0, notified = 0, failed = 0;
    const maxPerRun = Number(process.env.MAX_CHECKS_PER_RUN || 200);

    for (const email of emails) {
      if (checked >= maxPerRun) break;
      const watches = await getWatches(email);
      if (!watches.length) continue;
      const room = Math.max(0, maxPerRun - checked);
      const batch = watches.slice(0, room);
      const results = [];
      for (let i = 0; i < batch.length; i += 6) {
        const chunk = batch.slice(i, i + 6);
        results.push(...await Promise.all(chunk.map((w) => processWatch(email, w))));
      }
      const byId = new Map(results.map((r) => [r.updated.id, r.updated]));
      const latest = await getWatches(email);
      const next = latest.map((w) => byId.has(w.id) ? { ...w, ...byId.get(w.id) } : w);
      await setWatches(email, next);
      checked += results.length;
      notified += results.filter((r) => r.notified).length;
      failed += results.filter((r) => !r.ok).length;
    }

    return json(res, 200, { ok: true, checked, notified, failed, maxPerRun });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};

// Reuse the same notification rules for a manual check.
module.exports.processWatch = processWatch;
