const crypto = require('crypto');

const FREE_PLAN = { name: 'Free', limit: 3 };

const PLANS = {
  Basic: { name: 'Basic', price: 900, limit: 10 },
  Pro: { name: 'Pro', price: 1900, limit: 50 },
  Business: { name: 'Business', price: 3900, limit: 200 },
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function validUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(u.protocol);
  } catch { return false; }
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8')); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

function requiredEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    const err = new Error(`Missing environment variables: ${missing.join(', ')}`);
    err.code = 'MISSING_ENV';
    throw err;
  }
}

async function redis(command, ...args) {
  requiredEnv(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
  const base = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
  const encoded = [command, ...args].map((x) => encodeURIComponent(String(x))).join('/');
  const r = await fetch(`${base}/${encoded}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `Redis error ${r.status}`);
  return data.result;
}

async function getJSON(key, fallback = null) {
  const value = await redis('GET', key);
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function setJSON(key, value) {
  await redis('SET', key, JSON.stringify(value));
}

function effectivePlan(account) {
  const name = account?.plan;
  if (name && PLANS[name]) return { name, limit: PLANS[name].limit, paid: true };
  return { ...FREE_PLAN, paid: false };
}

async function getAccount(email) {
  return getJSON(`cenovurt:account:${normalizeEmail(email)}`, null);
}

async function setAccount(email, account) {
  const e = normalizeEmail(email);
  await setJSON(`cenovurt:account:${e}`, account);
  await redis('SADD', 'cenovurt:emails', e);
}

async function getWatches(email) {
  return getJSON(`cenovurt:watches:${normalizeEmail(email)}`, []);
}

async function setWatches(email, watches) {
  const e = normalizeEmail(email);
  await setJSON(`cenovurt:watches:${e}`, watches);
  await redis('SADD', 'cenovurt:emails', e);
}

function randomId() {
  return crypto.randomUUID();
}

async function stripeRequest(path, method = 'GET', params = null) {
  requiredEnv(['STRIPE_SECRET_KEY']);
  const opts = {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  };
  if (params) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params).toString();
  }
  const r = await fetch(`https://api.stripe.com${path}`, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Stripe error ${r.status}`);
  return data;
}

async function sendEmail({ to, subject, html }) {
  requiredEnv(['RESEND_API_KEY']);
  const from = process.env.RESEND_FROM || 'Ценовърт <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [normalizeEmail(to)], subject, html }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || `Email error ${r.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function parsePriceText(text) {
  if (!text) return null;
  const clean = String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s/g, '')
    .replace(/(EUR|BGN|лв\.?|€)/ig, '')
    .replace(/[^0-9,.]/g, '');
  if (!clean) return null;

  let normalized = clean;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  const decimalPos = Math.max(lastComma, lastDot);
  if (decimalPos >= 0) {
    const decimals = normalized.length - decimalPos - 1;
    if (decimals === 1 || decimals === 2) {
      const intPart = normalized.slice(0, decimalPos).replace(/[.,]/g, '');
      const decPart = normalized.slice(decimalPos + 1).replace(/[.,]/g, '');
      normalized = `${intPart}.${decPart}`;
    } else {
      normalized = normalized.replace(/[.,]/g, '');
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPrice(html) {
  const patterns = [
    /<meta[^>]+(?:property|itemprop|name)=["'](?:product:price:amount|price|og:price:amount)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|itemprop|name)=["'](?:product:price:amount|price|og:price:amount)["'][^>]*>/i,
    /["']price["']\s*:\s*["']?([0-9][0-9\s.,]*)["']?/i,
    /["']lowPrice["']\s*:\s*["']?([0-9][0-9\s.,]*)["']?/i,
    /(?:price|цена)[^0-9]{0,35}([0-9][0-9\s.,]{1,18})\s*(?:€|EUR|лв\.?|BGN)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const n = parsePriceText(m[1]);
      if (n) return n;
    }
  }
  return null;
}

async function fetchProductPrice(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CenovurtPriceBot/1.0; +https://cenovurt.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const price = extractPrice(html);
    if (!price) throw new Error('Цена не беше открита автоматично');
    return price;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  PLANS, FREE_PLAN, effectivePlan, json, normalizeEmail, validEmail, validUrl, parseBody,
  redis, getJSON, setJSON, getAccount, setAccount, getWatches, setWatches,
  randomId, stripeRequest, sendEmail, escapeHtml, fetchProductPrice,
};
