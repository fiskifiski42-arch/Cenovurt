const { clearSessionCookie, sameOrigin } = require('./_auth');
const { json } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.headers?.origin && !sameOrigin(req)) return json(res, 403, { error: 'Forbidden origin' });
  res.setHeader('Set-Cookie', clearSessionCookie());
  return json(res, 200, { ok: true });
};
