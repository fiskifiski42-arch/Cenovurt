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

const net = require('node:net');
const dns = require('node:dns').promises;

function productURL(value) {
  const u = new URL(String(value || '').trim());
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password ||
      u.href.length > 2048 || u.port ||
      !host.includes('.') || net.isIP(host) ||
      /\.(?:localhost|local|internal|test|invalid|example)$/.test(host)) {
    throw new Error('Приемат се само публични http/https линкове към магазини.');
  }
  return u;
}

function validUrl(value) {
  try { productURL(value); return true; } catch { return false; }
}

function publicIP(ip) {
  if (net.isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return !(v === '::1' || v === '::' || v.startsWith('::ffff:') ||
      /^(?:fc|fd|fe8|fe9|fea|feb)/.test(v));
  }
  if (net.isIP(ip) !== 4) return false;
  const p = ip.split('.').map(Number);
  return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && (p[1] === 168 || p[1] === 0)) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)));
}

async function safeProductURL(value) {
  const parsed = productURL(value);
  const records = await dns.lookup(parsed.hostname, { all: true });
  if (!records.length || records.some(r => !publicIP(r.address))) {
    throw new Error('Линкът сочи към непубличен адрес.');
  }
  return parsed;
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
  if (typeof html !== 'string' || !html) return null;
  const parseAttributes = tag => {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[match[1].toLowerCase()] = match[2] ?? match[3];
    }
    return attrs;
  };
  const eur = (value, currency = 'EUR') => {
    const amount = parsePriceText(value);
    if (!amount) return null;
    const unit = String(currency).trim().toUpperCase();
    if (unit === 'BGN' || unit === 'ЛВ' || unit === 'ЛВ.') {
      return Math.round(amount / 1.95583 * 100) / 100;
    }
    return unit === 'EUR' || unit === '€' ? amount : null;
  };
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => parseAttributes(m[0]));
  const metaName = m => String(m.property || m.itemprop || m.name || '').toLowerCase();
  const curr = metas.find(m => ['product:price:currency','og:price:currency','pricecurrency'].includes(metaName(m)));
  const currency = curr?.content || 'EUR';
  for (const m of metas) {
    if (['product:price:amount','og:price:amount','price'].includes(metaName(m))) {
      const value = eur(m.content, currency);
      if (value) return value;
    }
  }

  const priceInOffer = offer => {
    if (Array.isArray(offer)) {
      for (const item of offer) { const v = priceInOffer(item); if (v) return v; }
      return null;
    }
    if (!offer || typeof offer !== 'object') return null;
    const amount = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
    const unit = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? 'EUR';
    return eur(amount, unit);
  };
  const scan = data => {
    if (Array.isArray(data)) {
      for (const item of data) { const v = scan(item); if (v) return v; }
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
    if (types.some(type => /^(?:Product|Offer|AggregateOffer)$/i.test(String(type)))) {
      const v = priceInOffer(data.offers || data);
      if (v) return v;
    }
    return scan(data['@graph']);
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1])) continue;
    try { const v = scan(JSON.parse(match[2].trim())); if (v) return v; } catch {}
  }

  // Only currency-labelled amounts are accepted as fallback. Unknown values are not guessed.
  for (const match of html.matchAll(/(?:цена|price)\s*[:=]?\s*[^<>\n]{0,30}?([0-9][0-9\s.,]{0,16})\s*(€|EUR|лв\.?|BGN)/gi)) {
    const unit = /^лв/i.test(match[2]) ? 'BGN' : match[2];
    const v = eur(match[1], unit);
    if (v) return v;
  }
  return null;
}

async function fetchProductPrice(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    let current = productURL(url);
    for (let hop = 0; hop <= 5; hop++) {
      await safeProductURL(current.href);
      const r = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CenovurtPriceBot/1.1)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8'
        }
      });
      if (r.status >= 300 && r.status < 400) {
        const dest = r.headers.get('location');
        if (!dest) throw new Error('Сайтът пренасочва без валиден адрес.');
        current = productURL(new URL(dest, current).href);
        continue;
      }
      if (r.status === 403 || r.status === 429) {
        throw new Error('Магазинът блокира автоматичните проверки (HTTP ' + r.status + ').');
      }
      if (!r.ok) throw new Error('Магазинът върна HTTP ' + r.status + '.');
      const type = r.headers.get('content-type') || '';
      if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
        throw new Error('Адресът не връща HTML страница на продукт.');
      }
      if (Number(r.headers.get('content-length') || 0) > 3000000) {
        throw new Error('Страницата е прекалено голяма.');
      }
      const html = await r.text();
      if (html.length > 3000000) throw new Error('Страницата е прекалено голяма.');
      const price = extractPrice(html);
      if (!price) throw new Error('Не открих надеждна цена за този продукт.');
      return price;
    }
    throw new Error('Прекалено много пренасочвания от магазина.');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Магазинът не отговори до 10 секунди.');
    throw e;
  } finally { clearTimeout(timeout); }
}

module.exports = {
  PLANS, FREE_PLAN, effectivePlan, json, normalizeEmail, validEmail, validUrl, parseBody,
  redis, getJSON, setJSON, getAccount, setAccount, getWatches, setWatches,
  randomId, stripeRequest, sendEmail, escapeHtml, fetchProductPrice, extractPrice,
};
