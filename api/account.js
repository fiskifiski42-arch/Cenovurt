const { isOwner } = require('./_auth');
const { json, normalizeEmail, validEmail, getAccount, getWatches, effectivePlan } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const email = normalizeEmail(req.query?.email);
    if (!validEmail(email)) return json(res, 400, { error: 'Невалиден email.' });
    if (!isOwner(req, email)) return json(res, 401, { error: 'Първо потвърди имейла си с код.' });
    const [account, watches] = await Promise.all([getAccount(email), getWatches(email)]);
    const plan = effectivePlan(account);
    return json(res, 200, {
      email,
      plan: plan.name,
      limit: plan.limit,
      paidAt: account?.paidAt || null,
      active: true,
      paid: plan.paid,
      used: watches.length,
    });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
