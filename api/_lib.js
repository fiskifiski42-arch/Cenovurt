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

function effectivePlan(account, email) {
  // A verified account matching the server-configured owner email has no app-level watch limit.
  // Only configure CENOVURT_OWNER_EMAIL as a private Vercel environment variable.
  const ownerEmail = normalizeEmail(process.env.CENOVURT_OWNER_EMAIL);
  if (validEmail(ownerEmail) && normalizeEmail(email) === ownerEmail) {
    return { name: 'Owner', limit: null, paid: false };
  }
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

// All app thresholds and displayed prices are in EUR. Currency-labelled
// foreign prices must be converted using a verified live reference rate.
function amountInEuros(value, currency = 'EUR', rates = {}) {
  const amount = parsePriceText(value);
  if (!amount) return null;
  const unit = String(currency).trim().toUpperCase();
  if (unit === 'BGN' || unit === 'ЛВ' || unit === 'ЛВ.') {
    return Math.round(amount / 1.95583 * 100) / 100;
  }
  if (unit === 'EUR' || unit === '€') return amount;
  const rate = Number(rates[unit]);
  if ((unit === 'USD' || unit === 'GBP') && Number.isFinite(rate) && rate > 0) {
    return Math.round(amount / rate * 100) / 100;
  }
  return null;
}

// Retailer-specific hints complement standards-based Product JSON-LD. Keep them
// conservative: a listing price, old crossed-out price or recommendation is
// not proof of the watched product's current price.
function retailerPrice(html, sourceUrl, rates = {}) {
  let host = '';
  try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch { return null; }

  if (host === 'praktiker.bg' || host.endsWith('.praktiker.bg')) {
    const index = html.indexOf('product-store-prices__item');
    if (index >= 0) {
      // Scope to the product detail's price panel; ignore the old-price class.
      const panel = html.slice(index, index + 1600);
      const match = panel.match(/<span\b[^>]*class=["']product-price["'][^>]*>\s*<span\b[^>]*class=["']product-price__value["'][^>]*>\s*([0-9][0-9.,\s]*)/i);
      if (match) {
        const amount = parsePriceText(match[1]);
        if (amount) return amount;
      }
    }
  }

  if (/(^|\.)amazon\.[a-z.]+$/.test(host)) {
    // Only inspect the watched item's own price widgets, not recommendations
    // or crossed-out list prices elsewhere on an Amazon detail page.
    const amazonMoney = value => {
      const unit = /(?:€|EUR)/i.test(value) ? 'EUR' :
        /(?:£|GBP)/i.test(value) ? 'GBP' :
        /(?:USD|\$)/i.test(value) ? 'USD' : null;
      return unit ? amountInEuros(value, unit, rates) : null;
    };
    const fixed = html.match(/<[^>]*id=["'](?:priceblock_(?:ourprice|dealprice|saleprice)|price_inside_buybox)["'][^>]*>\s*([^<]+)</i);
    if (fixed) {
      const amount = amazonMoney(fixed[1]);
      if (amount) return amount;
    }

    const mainWidgets = [
      'corePriceDisplay_desktop_feature_div',
      'corePriceDisplay_mobile_feature_div',
      'corePrice_feature_div',
      'apex_desktop',
      'desktop_buybox',
      'mobile_buybox',
    ];
    for (const widget of mainWidgets) {
      const index = html.search(new RegExp('\\bid\\s*=\\s*["\\x27]' + widget + '["\\x27]', 'i'));
      if (index < 0) continue;
      const panel = html.slice(index, index + 9000);

      // The visible deal price takes priority over any list or typical price.
      const toPay = panel.match(/<[^>]*class=["'][^"']*(?:priceToPay|apexPriceToPay)[^"']*["'][^>]*>[\s\S]{0,3000}?<span\b[^>]*class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>\s*([^<]+)</i);
      if (toPay) {
        const amount = amazonMoney(toPay[1]);
        if (amount) return amount;
      }

      // Amazon also places the current price in a plain a-price wrapper.
      const prices = /<span\b[^>]*class=["']([^"']*)["'][^>]*>[\s\S]{0,1500}?<span\b[^>]*class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>\s*([^<]+)</gi;
      for (const price of panel.matchAll(prices)) {
        const classes = price[1].split(/\s+/);
        if (!classes.includes('a-price') || classes.includes('a-text-price')) continue;
        const amount = amazonMoney(price[2]);
        if (amount) return amount;
      }

      // A few variants omit the accessibility price and split euros/cents.
      const split = panel.match(/<span\b[^>]*class=["'][^"']*\ba-price-whole\b[^"']*["'][^>]*>\s*([0-9.,]+)(?:<[^>]+>[^<]*<\/[^>]+>)*\s*<\/span>\s*<span\b[^>]*class=["'][^"']*\ba-price-fraction\b[^"']*["'][^>]*>\s*(\d{2})/i);
      if (split) {
        const around = panel.slice(Math.max(0, split.index - 260), split.index + split[0].length);
        if (!/\ba-text-price\b/.test(around)) {
          const unit = /(?:€|EUR)/i.test(around) ? 'EUR' :
            /(?:£|GBP)/i.test(around) ? 'GBP' :
            /(?:USD|\$)/i.test(around) ? 'USD' : null;
          const whole = Number(split[1].replace(/[.,]/g, ''));
          const cents = Number(split[2]);
          if (unit && Number.isFinite(whole) && Number.isFinite(cents) && whole > 0) {
            return amountInEuros(whole + cents / 100, unit, rates);
          }
        }
      }
    }
  }
  return null;
}

function extractPrice(html, sourceUrl = '', rates = {}) {
  if (typeof html !== 'string' || !html) return null;
  let sourceHost = '';
  try { sourceHost = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
  const foreignAmazon = ['amazon.com', 'amazon.co.uk'].some(host =>
    sourceHost === host || sourceHost.endsWith('.' + host));
  const parseAttributes = tag => {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[match[1].toLowerCase()] = match[2] ?? match[3];
    }
    return attrs;
  };
  const eur = (value, currency = 'EUR') => amountInEuros(value, currency, rates);
  const shopPrice = retailerPrice(html, sourceUrl, rates);
  if (shopPrice) return shopPrice;
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => parseAttributes(m[0]));
  const metaName = m => String(m.property || m.itemprop || m.name || '').toLowerCase();
  const curr = metas.find(m => ['product:price:currency','og:price:currency','pricecurrency'].includes(metaName(m)));
  const currency = curr?.content || (foreignAmazon ? 'UNKNOWN' : 'EUR');
  for (const m of metas) {
    if (['product:price:amount','og:price:amount','price'].includes(metaName(m))) {
      const value = eur(m.content, currency);
      if (value) return value;
    }
  }

  // HTML Microdata is common on store pages that do not publish JSON-LD.
  const currencyTag = metas.find(m => ['pricecurrency', 'product:price:currency', 'og:price:currency'].includes(metaName(m)));
  for (const match of html.matchAll(/<(?:(?:span|div|p|data))\b[^>]*\bitemprop\s*=\s*["']price["'][^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    if (attrs.content || attrs.value) {
      const price = eur(attrs.content || attrs.value, currencyTag?.content || currency);
      if (price) return price;
    }
  }

  const priceInOffer = offer => {
    if (Array.isArray(offer)) {
      for (const item of offer) { const v = priceInOffer(item); if (v) return v; }
      return null;
    }
    if (!offer || typeof offer !== 'object') return null;
    const amount = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
    const unit = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? (foreignAmazon ? 'UNKNOWN' : 'EUR');
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

  // Amazon pages frequently contain unrelated recommendation prices. Do not
  // fall back to generic page-wide text on this domain.
  if (/(^|\.)amazon\.[a-z.]+$/.test(sourceHost)) return null;

  // Only currency-labelled amounts are accepted as fallback. Unknown values are not guessed.
  for (const match of html.matchAll(/(?:цена|price)\s*[:=]?\s*[^<>\n]{0,30}?([0-9][0-9\s.,]{0,16})\s*(€|EUR|лв\.?|BGN)/gi)) {
    const unit = /^лв/i.test(match[2]) ? 'BGN' : match[2];
    const v = eur(match[1], unit);
    if (v) return v;
  }
  return null;
}

// Remove advertising tracking that should not affect product identity or price.
function cleanProductURL(value) {
  const parsed = productURL(value);
  // Amazon product links often carry ad/session parameters that are unrelated
  // to the ASIN and can lead to locale-dependent or expired landing pages.
  // Keep the original marketplace (and thus its currency), but request the
  // canonical product URL from both the direct and the fallback providers.
  if (/^(?:www\.)?amazon\.(?:co\.uk|de)$/.test(parsed.hostname.toLowerCase())) {
    const product = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
    if (product) {
      parsed.pathname = '/dp/' + product[1].toUpperCase();
      parsed.search = '';
      parsed.hash = '';
      return parsed;
    }
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_.*|gclid|fbclid|msclkid)$/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = '';
  return parsed;
}

let cachedFxRates = {};
let cachedFxRatesAt = 0;

async function foreignUnitsPerEur(currency) {
  if (cachedFxRates[currency] && Date.now() - cachedFxRatesAt < 6 * 3600000) {
    return cachedFxRates[currency];
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', {
      signal: controller.signal,
      headers: { Accept: 'application/xml,text/xml' },
    });
    if (!response.ok) throw new Error('ECB HTTP ' + response.status);
    const xml = await response.text();
    if (xml.length > 100000) throw new Error('Invalid ECB response');
    const rates = {};
    for (const unit of ['USD', 'GBP']) {
      const match = xml.match(new RegExp('<Cube\\b[^>]*\\bcurrency=[\\x27"]' + unit +
        '[\\x27"][^>]*\\brate=[\\x27"]([0-9.]+)[\\x27"]', 'i'));
      const rate = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(rate) || rate < 0.4 || rate > 2) {
        throw new Error('Invalid ECB ' + unit + ' rate');
      }
      rates[unit] = rate;
    }
    cachedFxRates = rates;
    cachedFxRatesAt = Date.now();
    return rates[currency];
  } catch {
    const err = new Error('Не успях да проверя курса ' + currency +
      '/EUR от ЕЦБ. Опитай пак по-късно.');
    err.code = 'FX_RATE_UNAVAILABLE';
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function priceFromHtml(html, sourceUrl = '') {
  if (typeof html !== 'string' || html.length > 3000000) {
    throw new Error('Страницата е прекалено голяма или невалидна.');
  }
  let price = extractPrice(html, sourceUrl);
  let host = '';
  try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
  const currency = (host === 'amazon.com' || host.endsWith('.amazon.com')) ? 'USD' :
    (host === 'amazon.co.uk' || host.endsWith('.amazon.co.uk')) ? 'GBP' : null;
  const hasCurrency = currency === 'USD' ? /(?:\$\s*[0-9]|USD\b)/i.test(html) :
    currency === 'GBP' ? /(?:£\s*[0-9]|GBP\b)/i.test(html) : false;
  if (!price && hasCurrency) {
    price = extractPrice(html, sourceUrl, {
      [currency]: await foreignUnitsPerEur(currency),
    });
  }
  if (!price && /(^|\\.)amazon\\.[a-z.]+$/.test(host) &&
      /(?:to see the product details,?\\s*add this item to your basket|um produktdetails zu sehen,?\\s*lege diesen artikel in deinen einkaufswagen)/i
        .test(html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' '))) {
    const err = new Error('Amazon скрива продажната цена на този продукт, докато не го добавиш в кошницата. Не мога да потвърдя надеждна цена за автоматично следене.');
    err.code = 'AMAZON_PRICE_HIDDEN';
    throw err;
  }
  if (!price) {
    const err = new Error('Не открих надеждна цена за този продукт.');
    err.code = 'NO_PRICE';
    throw err;
  }
  return price;
}

async function directProductPrice(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    let current = cleanProductURL(url);
    for (let hop = 0; hop <= 5; hop++) {
      await safeProductURL(current.href);
      const r = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Cenovurt/1.2 (+price monitoring; contact site owner for data access)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8'
        }
      });
      if (r.status >= 300 && r.status < 400) {
        const dest = r.headers.get('location');
        if (!dest) throw new Error('Сайтът пренасочва без валиден адрес.');
        current = cleanProductURL(new URL(dest, current).href);
        continue;
      }
      if (r.status === 403 || r.status === 429) {
        const err = new Error('Магазинът блокира автоматичните проверки (HTTP ' + r.status + ').');
        err.code = 'BOT_BLOCKED';
        throw err;
      }
      if ([502, 503, 504].includes(r.status)) {
        // Some storefronts respond with a transient gateway/challenge page.
        // Give the already-configured fallback one chance instead of stopping.
        const err = new Error('Магазинът временно не предоставя страницата (HTTP ' + r.status + ').');
        err.code = 'SOURCE_UNAVAILABLE';
        throw err;
      }
      if (!r.ok) throw new Error('Магазинът върна HTTP ' + r.status + '.');
      const type = r.headers.get('content-type') || '';
      if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
        throw new Error('Адресът не връща HTML страница на продукт.');
      }
      if (Number(r.headers.get('content-length') || 0) > 3000000) {
        throw new Error('Страницата е прекалено голяма.');
      }
      return priceFromHtml(await r.text(), current.href);
    }
    throw new Error('Прекалено много пренасочвания от магазина.');
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('Магазинът не отговори до 9 секунди.');
      err.code = 'SOURCE_TIMEOUT';
      throw err;
    }
    throw e;
  } finally { clearTimeout(timeout); }
}

// Optional server-side source for sites that do not serve HTML to Vercel.
// Its key is held only in Vercel Environment Variables and is never returned to the browser.
async function zenRowsProductPrice(url) {
  const key = (process.env.ZENROWS_API_KEY || '').trim();
  if (!key) throw new Error('Резервният доставчик не е настроен (ZENROWS_API_KEY).');
  const target = cleanProductURL(url);
  await safeProductURL(target.href);
  const endpoint = new URL('https://api.zenrows.com/v1/');
  endpoint.searchParams.set('apikey', key);
  endpoint.searchParams.set('url', target.href);
  // Adaptive mode selects only the protections a site needs, avoiding a fixed
  // 25-credit JS-render + premium-proxy configuration for every fallback.
  endpoint.searchParams.set('mode', 'auto');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  try {
    const r = await fetch(endpoint.href, { redirect: 'manual', signal: controller.signal });
    if (r.status === 401 || r.status === 403) throw new Error('ZenRows: провери API ключа и достъпа си.');
    if (r.status === 402 || r.status === 429) throw new Error('ZenRows: няма налични кредити или е достигнат лимитът.');
    if (!r.ok) {
      // Preserve the provider's machine-readable reason without exposing API
      // tokens, raw response bodies, or accidentally treating errors as prices.
      let providerCode = '';
      try {
        const failure = JSON.parse((await r.text()).slice(0, 4096));
        if (typeof failure?.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(failure.code)) {
          providerCode = ', код ' + failure.code;
        }
      } catch {}
      if (r.status === 422) {
        throw new Error('ZenRows не успя да извлече страницата (HTTP 422' +
          providerCode + '). Сайтът може да блокира проверката; цена не е потвърдена.');
      }
      throw new Error('ZenRows не успя да отвори страницата (HTTP ' +
        r.status + providerCode + ').');
    }
    // ZenRows (and upstream sites) may label valid HTML as text/plain.
    // Check the actual body, rather than rejecting valid markup by its MIME type.
    if (Number(r.headers.get('content-length') || 0) > 3000000) {
      throw new Error('Страницата е прекалено голяма.');
    }
    const type = String(r.headers.get('content-type') || '').toLowerCase();
    const body = await r.text();
    if (body.length > 3000000) throw new Error('Страницата е прекалено голяма.');
    let html = body;
    // Some provider responses are JSON (including errors on HTTP 200).
    // Never mistake an API error object for a real product price.
    if (/\bjson\b/.test(type) || /^[\s]*[\{\[]/.test(body)) {
      let data;
      try { data = JSON.parse(body); } catch {}
      if (data && !Array.isArray(data) && typeof data.html === 'string') {
        html = data.html;
      } else {
        const code = data && typeof data.code === 'string' &&
          /^[a-zA-Z0-9_-]{1,50}$/.test(data.code) ? ' (код: ' + data.code + ')' : '';
        throw new Error('ZenRows върна JSON вместо HTML' + code +
          ' (HTTP ' + r.status + '). Не е получена проверима цена.');
      }
    }
    // Require real page markup. Never accept an error message or unknown
    // content type merely because it happens to contain a number.
    if (!/<!doctype\s+html|<html\b|<head\b|<body\b|<meta\b|<script\b|<main\b|<div\b/i.test(html)) {
      const label = type.replace(/[^a-z0-9\/+;=_. -]/g, '').slice(0, 80) || 'неизвестен';
      throw new Error('ZenRows не върна HTML съдържание (HTTP ' + r.status +
        ', тип: ' + label + ').');
    }
    return priceFromHtml(html, target.href);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('ZenRows не отговори до 22 секунди.');
    throw e;
  } finally { clearTimeout(timeout); }
}

async function fetchProductPrice(url) {
  try {
    return await directProductPrice(url);
  } catch (err) {
    // Do not spend provider credits on nonexistent pages or invalid links.
    if (!['BOT_BLOCKED', 'NO_PRICE', 'SOURCE_TIMEOUT', 'SOURCE_UNAVAILABLE'].includes(err.code)) throw err;
    if (!process.env.ZENROWS_API_KEY) {
      if (err.code === 'BOT_BLOCKED') {
        throw new Error(err.message + ' Добави ZENROWS_API_KEY във Vercel за резервна проверка.');
      }
      throw err;
    }
    return zenRowsProductPrice(url);
  }
}

module.exports = {
  PLANS, FREE_PLAN, effectivePlan, json, normalizeEmail, validEmail, validUrl, parseBody,
  redis, getJSON, setJSON, getAccount, setAccount, getWatches, setWatches,
  randomId, stripeRequest, sendEmail, escapeHtml, fetchProductPrice, extractPrice,
};
