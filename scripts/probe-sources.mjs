// Kaynak testi: her veri kaynağını tek tek dener, durumu yazar ve ham yanıtları
// probe-out/ klasörüne kaydeder (test örnekleri için). Sadece herkese açık
// piyasa verisi ve haber akışlarıyla çalışır; kişisel veri kullanmaz.
//
// Çalıştırma: node scripts/probe-sources.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { httpGet } from './lib/http.mjs';

const OUT = new URL('../probe-out/', import.meta.url);
const ORIGIN = 'https://emrekalpakci.github.io';
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

const now = new Date();
const unix = (d) => Math.floor(d.getTime() / 1000);
const daysAgo = (n) => new Date(now.getTime() - n * 86400000);
const isoDate = (d) => d.toISOString().slice(0, 10);

const checks = [
  // --- Ons altın / gümüş (canlı) ---
  ['goldapi_xau', 'https://api.gold-api.com/price/XAU'],
  ['goldapi_xag', 'https://api.gold-api.com/price/XAG'],
  ['goldapi_symbols', 'https://api.gold-api.com/symbols'],
  ['goldapi_xau_try', 'https://api.gold-api.com/price/XAU/TRY'],
  [
    'goldapi_history',
    `https://api.gold-api.com/history?symbol=XAU&startTimestamp=${unix(daysAgo(30))}&endTimestamp=${unix(now)}&groupBy=day`,
  ],
  ['swissquote_xau', 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD'],
  ['swissquote_xag', 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAG/USD'],
  ['swissquote_usdtry', 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/USD/TRY'],
  ['xaus_docs', 'https://xaus.com/api/'],
  ['xaus_spot', 'https://xaus.com/api/v1/spot'],
  ['xaus_history', 'https://xaus.com/api/v1/history'],
  ['xaus_history_xag', 'https://xaus.com/api/v1/history?symbol=xag'],
  ['xaus_chart_xag', 'https://xaus.com/api/v1/chart?symbol=xag'],
  ['xaus_intraday_xag', 'https://xaus.com/api/v1/intraday?symbol=xag'],

  // --- Dolar/TL ve günlük seriler ---
  ['frankfurter_v1_latest', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY'],
  ['frankfurter_v1_series', `https://api.frankfurter.dev/v1/${isoDate(daysAgo(40))}..?base=USD&symbols=TRY`],
  ['frankfurter_app_latest', 'https://api.frankfurter.app/latest?from=USD&to=TRY'],
  ['frankfurter_v2_rates', `https://api.frankfurter.dev/v2/rates?base=USD&quotes=TRY&from=${isoDate(daysAgo(10))}`],
  [
    'frankfurter_v2_tcmb',
    `https://api.frankfurter.dev/v2/rates?base=USD&quotes=TRY&from=${isoDate(daysAgo(10))}&providers=TCMB`,
  ],
  ['frankfurter_v2_xau', `https://api.frankfurter.dev/v2/rates?base=XAU&quotes=USD&from=${isoDate(daysAgo(10))}`],
  ['frankfurter_v2_xag', `https://api.frankfurter.dev/v2/rates?base=XAG&quotes=USD&from=${isoDate(daysAgo(10))}`],
  ['frankfurter_v2_currencies', 'https://api.frankfurter.dev/v2/currencies'],
  ['frankfurter_v2_providers', 'https://api.frankfurter.dev/v2/providers'],
  ['currencyapi_latest', 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json'],
  ['currencyapi_date', 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2024-03-06/v1/currencies/usd.min.json'],
  ['currencyapi_pages', 'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json'],
  ['tcmb_today', 'https://www.tcmb.gov.tr/kurlar/today.xml'],
  ['coingecko_rates', 'https://api.coingecko.com/api/v3/exchange_rates'],
  [
    'coingecko_simple',
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd,try',
  ],
  ['btcturk_usdttry', 'https://api.btcturk.com/api/v2/ticker?pairSymbol=USDTTRY'],

  // --- Kripto ---
  ['coinbase_ticker_btc', 'https://api.exchange.coinbase.com/products/BTC-USD/ticker'],
  ['coinbase_ticker_eth', 'https://api.exchange.coinbase.com/products/ETH-USD/ticker'],
  [
    'coinbase_candles_btc',
    `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${daysAgo(299).toISOString()}&end=${now.toISOString()}`,
  ],
  ['coinbase_spot_btc', 'https://api.coinbase.com/v2/prices/BTC-USD/spot'],
  ['coinbase_spot_eth', 'https://api.coinbase.com/v2/prices/ETH-USD/spot'],
  ['bitstamp_ticker_btc', 'https://www.bitstamp.net/api/v2/ticker/btcusd/'],
  ['bitstamp_ohlc_btc', `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${unix(daysAgo(1000))}`],
  ['bitstamp_ohlc_eth', `https://www.bitstamp.net/api/v2/ohlc/ethusd/?step=86400&limit=1000&start=${unix(daysAgo(1000))}`],
  ['kraken_ticker', 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD'],
  ['binance_vision_ticker', 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT'],

  // --- Haber akışları (RSS) ---
  ['rss_haberturk', 'https://www.haberturk.com/rss/ekonomi.xml'],
  ['rss_aa', 'https://www.aa.com.tr/tr/rss/default?cat=ekonomi'],
  ['rss_ntv', 'https://www.ntv.com.tr/ekonomi.rss'],
  ['rss_sozcu', 'https://www.sozcu.com.tr/feeds-rss-category-ekonomi'],
  ['rss_dunya', 'https://www.dunya.com/rss?dunya'],
  ['rss_bloomberght', 'https://www.bloomberght.com/rss'],
  ['rss_coindesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'],
  ['rss_cointelegraph', 'https://cointelegraph.com/rss'],
  ['rss_fxstreet', 'https://www.fxstreet.com/rss'],
  ['rss_google_altin', 'https://news.google.com/rss/search?q=alt%C4%B1n+when:1d&hl=tr&gl=TR&ceid=TR:tr'],
];

function preview(text) {
  return text.replace(/\s+/g, ' ').slice(0, 260);
}

function extOf(contentType, text) {
  if (/json/.test(contentType) || /^[\s]*[[{]/.test(text)) return 'json';
  if (/xml|rss|atom/.test(contentType) || /^\s*<\?xml/.test(text)) return 'xml';
  if (/html/.test(contentType)) return 'html';
  return 'txt';
}

async function probe(id, url) {
  let res = await httpGet(url, { headers: { Origin: ORIGIN }, retries: 1 });
  let ua = 'bot';
  // Bazı haber siteleri tarayıcı olmayan istemcileri reddeder; ikinci deneme tarayıcı kimliğiyle.
  if (!res.ok && id.startsWith('rss_') && (res.status === 403 || res.status === 0)) {
    res = await httpGet(url, { headers: { Origin: ORIGIN, 'User-Agent': BROWSER_UA }, retries: 0 });
    ua = 'tarayici';
  }
  const ct = res.headers?.get('content-type') || '';
  const cors = res.headers?.get('access-control-allow-origin') || '-';
  const ext = extOf(ct, res.text);
  if (res.text) await writeFile(new URL(`${id}.${ext}`, OUT), res.text.slice(0, 400_000));
  return { id, url, ok: res.ok, status: res.status, ms: res.ms, ua, cors, ct, bytes: res.text.length, error: res.error, preview: preview(res.text) };
}

await mkdir(OUT, { recursive: true });
const results = [];
for (const [id, url] of checks) {
  const r = await probe(id, url);
  results.push(r);
  const mark = r.ok ? 'OK ' : 'HATA';
  console.log(`${mark} ${String(r.status).padStart(3)} ${String(r.ms).padStart(5)}ms cors=${r.cors.padEnd(24).slice(0, 24)} ua=${r.ua.padEnd(8)} ${r.id}`);
  console.log(`      ${r.preview}`);
}
await writeFile(new URL('summary.json', OUT), JSON.stringify({ at: now.toISOString(), results }, null, 2));
const okCount = results.filter((r) => r.ok).length;
console.log(`\nToplam: ${okCount}/${results.length} kaynak yanıt verdi.`);
