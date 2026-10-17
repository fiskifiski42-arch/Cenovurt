const { json, normalizeEmail, validEmail, getAccount, getWatches } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const email = normalizeEmail(req.query?.email);
    if (!validEmail(email)) return json(res, 400, { error: 'Невалиден email.' });
    const [account, watches] = await Promise.all([getAccount(email), getWatches(email)]);
    return json(res, 200, {
      email,
      plan: account?.plan || null,
      limit: account?.limit || 0,
      paidAt: account?.paidAt || null,
      active: Boolean(account?.plan),
      used: watches.length,
    });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
