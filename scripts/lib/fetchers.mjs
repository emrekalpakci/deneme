// Veri kaynaklarına istek atan fonksiyonlar (sadece Node / GitHub Actions).
// Her fonksiyon ya geçerli bir değer ya da nedeniyle birlikte "yok" döner; asla uydurmaz.

import { httpGet } from './http.mjs';
import * as S from '../../site/js/core/sources.js';
import { unavailable, isUsable } from '../../site/js/core/datum.js';
import { normalize, addDays } from '../../site/js/core/series.js';

const FRANKFURTER = 'https://api.frankfurter.dev';

/** JSON ya da metin getirir; hata halinde gövdesiz, kısa bir neden döner. */
async function get(url, { json = true } = {}) {
  const res = await httpGet(url, { retries: 1, timeoutMs: 20000 });
  if (!res.ok) return { ok: false, why: res.error || `HTTP ${res.status}`, ms: res.ms };
  if (!json) return { ok: true, data: res.text, ms: res.ms };
  try {
    return { ok: true, data: JSON.parse(res.text), ms: res.ms };
  } catch {
    return { ok: false, why: 'JSON ayrıştırılamadı', ms: res.ms };
  }
}

/** İstek + ayrıştırma; ağ hatasında "yok" verisi döner. */
async function liveFrom(src, url, parse, opts) {
  const r = await get(url, opts);
  if (!r.ok) return { datum: unavailable(src, r.why), ms: r.ms };
  return { datum: parse(r.data, new Date().toISOString()), ms: r.ms };
}

// --- Canlı fiyat sağlayıcıları (sıra = öncelik) -----------------------------

export function metalProviders(symbol) {
  return [
    { id: 'goldapi', run: () => liveFrom(S.SRC.GOLDAPI, `https://api.gold-api.com/price/${symbol}`, (j) => S.parseGoldApi(j, symbol)) },
    {
      id: 'swissquote',
      run: () =>
        liveFrom(
          S.SRC.SWISSQUOTE,
          `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${symbol}/USD`,
          S.parseSwissquote,
        ),
    },
    { id: 'xaus', run: () => liveFrom(S.SRC.XAUS, 'https://xaus.com/api/v1/spot', (j) => S.parseXausSpot(j)[symbol] || unavailable(S.SRC.XAUS, 'sembol yok')) },
    {
      id: 'currencyapi',
      run: () =>
        liveFrom(
          S.SRC.CURRENCYAPI,
          'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
          (j) => S.parseCurrencyApi(j)[symbol] || unavailable(S.SRC.CURRENCYAPI, 'sembol yok'),
        ),
    },
  ];
}

export function cryptoProviders(symbol) {
  const lower = symbol.toLowerCase();
  return [
    { id: 'coinbase', run: () => liveFrom(S.SRC.COINBASE, `https://api.exchange.coinbase.com/products/${symbol}-USD/ticker`, S.parseCoinbaseTicker) },
    { id: 'bitstamp', run: () => liveFrom(S.SRC.BITSTAMP, `https://www.bitstamp.net/api/v2/ticker/${lower}usd/`, S.parseBitstampTicker) },
    {
      id: 'binance',
      run: () => liveFrom(S.SRC.BINANCE, `https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}USDT`, (j, t) => S.parseBinanceTicker(j, t)),
    },
  ];
}

export function usdTryProviders() {
  return [
    {
      id: 'swissquote',
      run: () =>
        liveFrom(S.SRC.SWISSQUOTE, 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/USD/TRY', S.parseSwissquote),
    },
    { id: 'coingecko', run: () => liveFrom(S.SRC.COINGECKO, 'https://api.coingecko.com/api/v3/exchange_rates', (j, t) => S.parseCoinGeckoRates(j, t).USDTRY) },
    { id: 'tcmb', run: () => liveFrom(S.SRC.TCMB, 'https://www.tcmb.gov.tr/kurlar/today.xml', (x) => S.parseTcmbXml(x), { json: false }) },
    {
      id: 'currencyapi',
      run: () =>
        liveFrom(S.SRC.CURRENCYAPI, 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json', (j) => S.parseCurrencyApi(j).USDTRY),
    },
  ];
}

/**
 * Sağlayıcıları sırayla dener. İlk kullanılabilir değeri döner.
 * accept(datum) false dönerse (ör. doğrulanmamış sıçrama) sonraki kaynakla doğrulama denenir.
 * Dönen attempts listesi sadece kaynak adı, süre ve sonucu içerir (kişisel veri yok).
 */
export async function firstUsable(providers, { accept } = {}) {
  const attempts = [];
  let pending = null; // kabul edilmemiş ama kullanılabilir ilk değer
  for (const p of providers) {
    const { datum, ms } = await p.run();
    const usable = isUsable(datum);
    attempts.push({ id: p.id, ok: usable, ms, why: usable ? null : datum.why });
    if (!usable) continue;
    if (pending) {
      // İkinci kaynak ilk değeri %2 içinde doğruluyorsa ilk değer kabul edilir.
      if (Math.abs(datum.v / pending.v - 1) <= 0.02) return { datum: pending, attempts, confirmedBy: p.id };
      continue;
    }
    if (!accept || accept(datum)) return { datum, attempts };
    pending = datum;
  }
  if (pending) {
    return { datum: unavailable(pending.src, 'ani fiyat değişimi ikinci kaynakla doğrulanamadı'), attempts };
  }
  const why = attempts.map((a) => `${a.id}: ${a.why}`).join('; ');
  return { datum: unavailable('tüm kaynaklar', why || 'kaynak yok'), attempts };
}

// --- Günlük geçmiş ----------------------------------------------------------

export async function xausGoldHistory() {
  const r = await get('https://xaus.com/api/v1/history');
  return r.ok ? { points: S.parseXausHistory(r.data), ms: r.ms } : { points: [], why: r.why, ms: r.ms };
}

/** Frankfurter v2 günlük seri. providers verilirse sadece o kaynak (ör. TCMB). */
export async function frankfurterSeries(base, quote, from, providers) {
  const q = new URLSearchParams({ base, quotes: quote, from });
  if (providers) q.set('providers', providers);
  const r = await get(`${FRANKFURTER}/v2/rates?${q}`);
  return r.ok ? { points: S.parseFrankfurterV2(r.data), ms: r.ms } : { points: [], why: r.why, ms: r.ms };
}

/** Frankfurter v1 (ECB) USD/TRY serisi — TCMB serisi alınamazsa yedek. */
export async function frankfurterV1UsdTry(from) {
  const r = await get(`${FRANKFURTER}/v1/${from}..?base=USD&symbols=TRY`);
  return r.ok ? { points: S.parseFrankfurterV1Series(r.data, 'TRY'), ms: r.ms } : { points: [], why: r.why, ms: r.ms };
}

/** Bitstamp günlük kapanışlar; 1000'lik sayfalarla ileri doğru çeker. */
export async function bitstampHistory(symbol, from) {
  const pair = `${symbol.toLowerCase()}usd`;
  let start = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const all = [];
  for (let page = 0; page < 8; page++) {
    const r = await get(`https://www.bitstamp.net/api/v2/ohlc/${pair}/?step=86400&limit=1000&start=${start}`);
    if (!r.ok) return { points: normalize(all), why: r.why };
    const pts = S.parseBitstampOhlc(r.data);
    if (!pts.length) break;
    all.push(...pts);
    const last = pts[pts.length - 1][0];
    if (pts.length < 1000) break;
    start = Math.floor(new Date(`${addDays(last, 1)}T00:00:00Z`).getTime() / 1000);
  }
  return { points: normalize(all) };
}

/** Coinbase günlük kapanışlar (son ~300 gün); Bitstamp ile çapraz kontrol için. */
export async function coinbaseRecent(symbol, days = 299) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const url = `https://api.exchange.coinbase.com/products/${symbol}-USD/candles?granularity=86400&start=${start.toISOString()}&end=${end.toISOString()}`;
  const r = await get(url);
  return r.ok ? { points: normalize(S.parseCoinbaseCandles(r.data)) } : { points: [], why: r.why };
}

/** currency-api'nin belirli bir güne ait dosyası (2024-03-02'den beri). Çapraz kontrol için. */
export async function currencyApiOn(day) {
  const r = await get(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.min.json`);
  return r.ok ? S.parseCurrencyApi(r.data) : null;
}
