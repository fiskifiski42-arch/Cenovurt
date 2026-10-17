const { PLANS, json, parseBody, normalizeEmail, validEmail, stripeRequest } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    const plan = PLANS[body.plan];
    if (!validEmail(email)) return json(res, 400, { error: 'Въведи валиден email.' });
    if (!plan) return json(res, 400, { error: 'Невалиден пакет.' });

    const origin = process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const params = {
      mode: 'payment',
      customer_email: email,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': String(plan.price),
      'line_items[0][price_data][product_data][name]': `Ценовърт ${plan.name}`,
      'line_items[0][price_data][product_data][description]': `Еднократен план – до ${plan.limit} наблюдавани продукта`,
      'metadata[plan]': plan.name,
      'metadata[email]': email,
      success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?payment=cancelled`,
      allow_promotion_codes: 'true',
    };

    const session = await stripeRequest('/v1/checkout/sessions', 'POST', params);
    return json(res, 200, { url: session.url });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
