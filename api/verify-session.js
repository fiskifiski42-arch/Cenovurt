const { PLANS, json, stripeRequest, normalizeEmail, validEmail, setAccount, getAccount } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const id = String(req.query?.session_id || '').trim();
    if (!id.startsWith('cs_')) return json(res, 400, { error: 'Невалидна Stripe сесия.' });
    const session = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(id)}`);
    if (session.payment_status !== 'paid' || session.status !== 'complete') {
      return json(res, 402, { error: 'Плащането още не е потвърдено.' });
    }
    const email = normalizeEmail(session.customer_details?.email || session.customer_email || session.metadata?.email);
    const plan = PLANS[session.metadata?.plan];
    if (!validEmail(email) || !plan) return json(res, 400, { error: 'Липсват данни за пакет или email.' });

    const existing = await getAccount(email);
    const rank = { Basic: 1, Pro: 2, Business: 3 };
    const chosen = existing && rank[existing.plan] > rank[plan.name]
      ? existing
      : {
          email,
          plan: plan.name,
          limit: plan.limit,
          paidAt: new Date().toISOString(),
          stripeSessionId: id,
        };
    await setAccount(email, chosen);
    return json(res, 200, { ok: true, email, plan: chosen.plan, limit: chosen.limit });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
