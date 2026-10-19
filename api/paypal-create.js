const { isOwner } = require('./_auth');
const { PLANS, json, parseBody, normalizeEmail, validEmail, redis } = require('./_lib');
const { paypalRequest } = require('./_paypal');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const { email: rawEmail, plan: planName } = await parseBody(req);
    const email = normalizeEmail(rawEmail);
    const plan = PLANS[planName];
    if (!validEmail(email)) return json(res, 400, { error: 'Въведи валиден email.' });
    if (!isOwner(req, email)) return json(res, 401, { error: 'Първо потвърди имейла си с код.' });
    if (!plan) return json(res, 400, { error: 'Невалиден пакет.' });

    // Never trust request headers or the browser as a payment callback destination.
    const origin = process.env.APP_URL || 'https://cenovurt.vercel.app';
    if (!/^https:\/\/[^/?#]+$/.test(origin)) throw new Error('Невалиден APP_URL.');
    const amount = (plan.price / 100).toFixed(2);
    const order = await paypalRequest('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{
        description: 'Ценовърт ' + plan.name,
        amount: { currency_code: 'EUR', value: amount },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Ценовърт',
            user_action: 'PAY_NOW',
            return_url: origin + '/?payment=paypal-return',
            cancel_url: origin + '/?payment=cancelled',
          },
        },
      },
    });

    if (!/^[A-Z0-9]{10,30}$/i.test(order.id || '')) throw new Error('PayPal не върна валидна поръчка.');
    const approve = (order.links || []).find(link => link.rel === 'payer-action' || link.rel === 'approve');
    if (!approve || !/^https:\/\/www\.(sandbox\.)?paypal\.com\//i.test(approve.href || '')) {
      throw new Error('PayPal не върна валиден адрес за потвърждение.');
    }
    // A pending order binds the PayPal order to an already authenticated user and fixed server price.
    await redis('SET', 'cenovurt:paypal:' + order.id, JSON.stringify({
      email, plan: plan.name, amount, createdAt: Date.now(),
    }), 'EX', 86400);
    return json(res, 200, { url: approve.href });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
