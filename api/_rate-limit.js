const crypto = require('node:crypto');

async function allowIpRequest(req, action, maxRequests, windowSeconds) {
  // Vercel overwrites X-Forwarded-For with the verified client address.
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  if (!ip) return true; // Local development and tests without proxy headers.
  const hash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
  const key = 'cenovurt:ip-budget:' + action + ':' + hash;
  const { redis } = require('./_lib');
  const attempts = Number(await redis('INCR', key));
  if (attempts === 1) await redis('EXPIRE', key, String(windowSeconds));
  return attempts <= maxRequests;
}

module.exports = { allowIpRequest };
