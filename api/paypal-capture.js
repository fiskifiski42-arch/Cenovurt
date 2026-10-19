const { tokenEmail } = require('./_auth');
const { PLANS, json, parseBody, getJSON, setJSON, getAccount, setAccount } = require('./_lib');
const { paypalRequest } = require('./_paypal');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const email = tokenEmail(req);
    if (!email) return json(res, 401, { error: 'Първо потвърди имейла си с код.' });
    const body = await parseBody(req);
    const id = String(body.orderId || '').trim();
    if (!/^[A-Z0-9]{10,30}$/i.test(id)) return json(res, 400, { error: 'Невалидна PayPal поръчка.' });
    const key = 'cenovurt:paypal:' + id;
    const pending = await getJSON(key);
    if (!pending || pending.email !== email) return json(res, 403, { error: 'Нямаш достъп до тази поръчка.' });
    const plan = PLANS[pending.plan];
    if (!plan || (plan.price / 100).toFixed(2) !== pending.amount) {
      return json(res, 400, { error: 'Невалидни данни за пакета.' });
    }

    let order;
    if (pending.captured) {
      order = await paypalRequest('/v2/checkout/orders/' + encodeURIComponent(id));
    } else {
      // Idempotency protects against repeated return-page requests.
      order = await paypalRequest('/v2/checkout/orders/' + encodeURIComponent(id) + '/capture',
        'POST', {}, 'cenovurt-capture-' + id);
    }
    const completed = order.status === 'COMPLETED' &&
      (order.purchase_units || []).some(unit =>
        (unit.payments?.captures || []).some(payment =>
          payment.status === 'COMPLETED' &&
          payment.amount?.currency_code === 'EUR' &&
          payment.amount?.value === pending.amount));
    if (!completed) return json(res, 402, { error: 'PayPal не е потвърдил успешно плащане.' });

    // Mark the order captured before changing access; a repeat can safely inspect PayPal's order.
    await setJSON(key, { ...pending, captured: true });
    const existing = await getAccount(email);
    const rank = { Basic: 1, Pro: 2, Business: 3 };
    const chosen = existing && rank[existing.plan] > rank[plan.name]
      ? existing
      : { email, plan: plan.name, limit: plan.limit, paidAt: new Date().toISOString(), paypalOrderId: id };
    await setAccount(email, chosen);
    return json(res, 200, { ok: true, email, plan: chosen.plan, limit: chosen.limit });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
