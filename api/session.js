const { tokenEmail, issueToken, sessionCookie } = require('./_auth');
const { json } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const email = tokenEmail(req);
    if (!email) return json(res, 401, { error: 'Сесията е изтекла. Влез отново с код.' });
    res.setHeader('Set-Cookie', sessionCookie(issueToken(email)));
    return json(res, 200, { ok: true, email });
  } catch (e) {
    return json(res, e.code === 'MISSING_ENV' ? 503 : 500, { error: e.message });
  }
};
