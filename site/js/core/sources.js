// Veri kaynaklarının yanıtlarını ayrıştıran saf fonksiyonlar (ağ isteği yapmaz).
// Hem tarayıcıda (canlı fiyat) hem GitHub Actions'ta aynı kod kullanılır.
// Kural: Beklenmeyen bir yanıt geldiğinde hata fırlatılmaz, "yok" (unavailable) döner.

import { positivePrice, unavailable } from './datum.js';

export const SRC = Object.freeze({
  GOLDAPI: 'gold-api.com',
  SWISSQUOTE: 'Swissquote',
  XAUS: 'xaus.com',
  FRANKFURTER: 'Frankfurter',
  FRANKFURTER_TCMB: 'TCMB (Frankfurter)',
  CURRENCYAPI: 'currency-api (günlük)',
  COINBASE: 'Coinbase',
  BITSTAMP: 'Bitstamp',
  COINGECKO: 'CoinGecko',
  TCMB: 'TCMB',
  BINANCE: 'Binance (USDT)',
});

const num = (x) => (typeof x === 'string' && x.trim() !== '' ? Number(x) : x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Değeri pozitif sonlu sayıya çevirir; olmazsa null. */
function positive(x) {
  const n = num(x);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

// --- Canlı fiyatlar --------------------------------------------------------

/** gold-api.com: {"price": 4195.6, "symbol": "XAU", "updatedAt": "..."} */
export function parseGoldApi(json, symbol) {
  if (!isObj(json)) return unavailable(SRC.GOLDAPI, 'beklenmeyen yanıt');
  if (symbol && json.symbol !== symbol) return unavailable(SRC.GOLDAPI, 'sembol uyuşmuyor');
  return positivePrice(num(json.price), json.updatedAt, SRC.GOLDAPI);
}

/**
 * Swissquote: platform listesi; her birinde alış/satış fiyatları ve ts (ms).
 * Orta fiyat = (alış + satış) / 2. Makas %2'den genişse güvenilmez sayılır.
 */
export function parseSwissquote(json) {
  if (!Array.isArray(json) || json.length === 0) return unavailable(SRC.SWISSQUOTE, 'beklenmeyen yanıt');
  const platform = json.find((p) => Array.isArray(p?.spreadProfilePrices) && p.spreadProfilePrices.length);
  if (!platform) return unavailable(SRC.SWISSQUOTE, 'fiyat yok');
  const profiles = platform.spreadProfilePrices;
  const prof = profiles.find((p) => p.spreadProfile === 'prime') || profiles[0];
  const bid = positive(prof.bid);
  const ask = positive(prof.ask);
  if (!bid || !ask || ask < bid) return unavailable(SRC.SWISSQUOTE, 'alış/satış geçersiz');
  const mid = (bid + ask) / 2;
  if ((ask - bid) / mid > 0.02) return unavailable(SRC.SWISSQUOTE, 'alış-satış makası çok geniş');
  const ts = num(platform.ts);
  if (!Number.isFinite(ts)) return unavailable(SRC.SWISSQUOTE, 'zaman bilgisi yok');
  return positivePrice(Number(mid.toFixed(6)), ts, SRC.SWISSQUOTE);
}

/** xaus.com /api/v1/spot: altın ve gümüş ons fiyatı. */
export function parseXausSpot(json) {
  if (!isObj(json)) {
    const u = unavailable(SRC.XAUS, 'beklenmeyen yanıt');
    return { XAU: u, XAG: u };
  }
  const asOf = json.price_as_of || json.updated_at;
  const mark = (d) => (json.stale === true && d.st === 'ok' ? { ...d, st: 'stale', why: 'kaynak eski veri bildiriyor' } : d);
  return {
    XAU: mark(positivePrice(num(json.spot_usd_oz), asOf, SRC.XAUS)),
    XAG: mark(positivePrice(num(json.silver_usd_oz), asOf, SRC.XAUS)),
  };
}

/** Coinbase Exchange ticker: {"price": "82932.79", "time": "..."} */
export function parseCoinbaseTicker(json) {
  if (!isObj(json)) return unavailable(SRC.COINBASE, 'beklenmeyen yanıt');
  return positivePrice(num(json.price), json.time, SRC.COINBASE);
}

/** Coinbase spot (tarayıcı): {"data": {"amount": "82931.1", "base": "BTC", "currency": "USD"}} */
export function parseCoinbaseSpot(json, fetchedAt, base) {
  const d = json?.data;
  if (!isObj(d) || d.currency !== 'USD' || (base && d.base !== base)) {
    return unavailable(SRC.COINBASE, 'beklenmeyen yanıt');
  }
  return positivePrice(num(d.amount), fetchedAt, SRC.COINBASE);
}

/** Bitstamp ticker: {"last": "82934.01", "timestamp": "1791705252"} */
export function parseBitstampTicker(json) {
  if (!isObj(json)) return unavailable(SRC.BITSTAMP, 'beklenmeyen yanıt');
  const ts = num(json.timestamp);
  return positivePrice(num(json.last), Number.isFinite(ts) ? ts * 1000 : null, SRC.BITSTAMP);
}

/** Binance (USDT paritesi, yaklaşık USD): {"symbol": "BTCUSDT", "price": "83016.01"} */
export function parseBinanceTicker(json, fetchedAt) {
  if (!isObj(json)) return unavailable(SRC.BINANCE, 'beklenmeyen yanıt');
  return positivePrice(num(json.price), fetchedAt, SRC.BINANCE);
}

/**
 * CoinGecko /exchange_rates: tüm değerler 1 BTC karşılığıdır.
 * Dolar/TL = try / usd; ons altın USD = usd / xau.
 */
export function parseCoinGeckoRates(json, fetchedAt) {
  const r = json?.rates;
  const val = (k) => positive(r?.[k]?.value);
  const usd = val('usd');
  const ratio = (a, b) => (a && b ? positivePrice(a / b, fetchedAt, SRC.COINGECKO) : unavailable(SRC.COINGECKO, 'değer yok'));
  return {
    USDTRY: ratio(val('try'), usd),
    XAU: ratio(usd, val('xau')),
    XAG: ratio(usd, val('xag')),
  };
}

/** TCMB today.xml: USD döviz alış/satış ortası. Yayın saati 15:30 (TSİ) kabul edilir. */
export function parseTcmbXml(text) {
  if (typeof text !== 'string') return unavailable(SRC.TCMB, 'beklenmeyen yanıt');
  const date = text.match(/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
  const usd = text.match(/<Currency[^>]*CurrencyCode="USD"[^>]*>([\s\S]*?)<\/Currency>/);
  if (!date || !usd) return unavailable(SRC.TCMB, 'beklenmeyen yanıt');
  const buy = positive(usd[1].match(/<ForexBuying>([\d.]+)<\/ForexBuying>/)?.[1]);
  const sell = positive(usd[1].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/)?.[1]);
  if (!buy || !sell) return unavailable(SRC.TCMB, 'kur yok');
  const asOf = `${date[3]}-${date[2]}-${date[1]}T12:30:00Z`;
  return positivePrice(Number(((buy + sell) / 2).toFixed(6)), asOf, SRC.TCMB);
}

/**
 * currency-api (günlük): {"date": "2026-10-11", "usd": {"try": 49.2, "xau": 0.000238...}}
 * Değerler "1 USD kaç birim" şeklindedir; ons altın USD = 1 / xau.
 */
export function parseCurrencyApi(json) {
  const u = json?.usd;
  const date = json?.date;
  const asOf = typeof date === 'string' && DAY_RE.test(date) ? `${date}T00:00:00Z` : null;
  const inv = (k) => {
    const v = positive(u?.[k]);
    return v ? 1 / v : null;
  };
  const mk = (v) => (isObj(u) ? positivePrice(v, asOf, SRC.CURRENCYAPI) : unavailable(SRC.CURRENCYAPI, 'beklenmeyen yanıt'));
  return {
    USDTRY: mk(positive(u?.try)),
    XAU: mk(inv('xau')),
    XAG: mk(inv('xag')),
    BTC: mk(inv('btc')),
    ETH: mk(inv('eth')),
  };
}

// --- Günlük seriler ([["YYYY-AA-GG", kapanış], ...]) ------------------------

/** xaus.com /api/v1/history: {"points": [{"d": "2021-10-11", "c": 1755.7}, ...]} */
export function parseXausHistory(json) {
  if (!Array.isArray(json?.points)) return [];
  return json.points.map((p) => [p?.d, positive(p?.c)]).filter(validPoint);
}

/** Frankfurter v2 /rates: [{"date": "2026-10-01", "rate": 49.03}, ...] */
export function parseFrankfurterV2(json) {
  if (!Array.isArray(json)) return [];
  return json.map((r) => [r?.date, positive(r?.rate)]).filter(validPoint);
}

/** Frankfurter v1 zaman serisi: {"rates": {"2026-09-01": {"TRY": 48.27}}} */
export function parseFrankfurterV1Series(json, quote) {
  if (!isObj(json?.rates)) return [];
  return Object.entries(json.rates)
    .map(([d, r]) => [d, positive(r?.[quote])])
    .filter(validPoint);
}

/** Coinbase günlük mumlar: [[zaman(sn), düşük, yüksek, açılış, kapanış, hacim], ...] (yeniden eskiye) */
export function parseCoinbaseCandles(json) {
  if (!Array.isArray(json)) return [];
  return json
    .map((c) => (Array.isArray(c) ? [Number.isFinite(c[0]) ? isoDay(c[0] * 1000) : null, positive(c[4])] : [null, null]))
    .filter(validPoint);
}

/** Bitstamp OHLC: {"data": {"ohlc": [{"timestamp": "1705276800", "close": "42493.00"}, ...]}} */
export function parseBitstampOhlc(json) {
  const rows = json?.data?.ohlc;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const ts = num(r?.timestamp);
      return [Number.isFinite(ts) ? isoDay(ts * 1000) : null, positive(r?.close)];
    })
    .filter(validPoint);
}

function validPoint(p) {
  return typeof p[0] === 'string' && DAY_RE.test(p[0]) && typeof p[1] === 'number';
}
