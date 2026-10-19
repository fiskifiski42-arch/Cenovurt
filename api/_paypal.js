// PayPal REST Orders v2; keep credentials exclusively in Vercel environment variables.
function config() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    const error = new Error('PayPal не е настроен. Не са активирани плащания.');
    error.code = 'MISSING_ENV';
    throw error;
  }
  const mode = process.env.PAYPAL_MODE || 'sandbox';
  if (mode !== 'sandbox' && mode !== 'live') throw new Error('Невалиден PAYPAL_MODE.');
  if (mode === 'live' && process.env.PAYPAL_ENABLE_LIVE !== 'true') {
    const error = new Error('Реалните PayPal плащания не са разрешени.');
    error.code = 'MISSING_ENV';
    throw error;
  }
  return {
    clientId, secret,
    base: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
  };
}

async function paypalRequest(path, method = 'GET', body = null, requestId = null) {
  const { clientId, secret, base } = config();
  const auth = Buffer.from(clientId + ':' + secret).toString('base64');
  const tokenResponse = await fetch(base + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error('PayPal не прие настройките за достъп.');
  }
  const headers = { Authorization: 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const response = await fetch(base + path, {
    method, headers, ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('PayPal: ' + String(result.message || 'неуспешна заявка').slice(0, 200));
    error.status = response.status;
    throw error;
  }
  return result;
}

module.exports = { paypalRequest };
