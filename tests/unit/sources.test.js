// Kaynak ayrıştırıcıları, GitHub sunucusundan alınmış gerçek yanıtlarla (kısaltılmış) test edilir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../../site/js/core/sources.js';

const fx = (name) => JSON.parse(readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url), 'utf8'));
const fxText = (name) => readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url), 'utf8');
const NOW = '2026-10-11T07:54:00Z';

test('gold-api: ons altın ve gümüş', () => {
  const xau = S.parseGoldApi(fx('goldapi_xau.json'), 'XAU');
  assert.equal(xau.st, 'ok');
  assert.equal(xau.v, 4195.600098);
  assert.equal(xau.asOf, '2026-10-11T07:53:36.000Z');
  assert.equal(S.parseGoldApi(fx('goldapi_xag.json'), 'XAG').v, 60.949001);
  assert.equal(S.parseGoldApi(fx('goldapi_xag.json'), 'XAU').st, 'unavailable', 'sembol uyuşmazlığı');
  assert.equal(S.parseGoldApi(fx('goldapi_history.json'), 'XAU').st, 'unavailable', 'hata yanıtı');
});

test('Swissquote: alış-satış ortası ve zaman', () => {
  const usdtry = S.parseSwissquote(fx('swissquote_usdtry.json'));
  assert.equal(usdtry.st, 'ok');
  assert.ok(Math.abs(usdtry.v - (49.14333 + 49.39785) / 2) < 1e-6);
  assert.equal(usdtry.asOf, new Date(1791579600084).toISOString());
  const xau = S.parseSwissquote(fx('swissquote_xau.json'));
  assert.ok(xau.v > 4190 && xau.v < 4200);
  const wide = [{ ts: 1, spreadProfilePrices: [{ spreadProfile: 'prime', bid: 40, ask: 50 }] }];
  assert.equal(S.parseSwissquote(wide).st, 'unavailable', 'çok geniş makas reddedilir');
  assert.equal(S.parseSwissquote([]).st, 'unavailable');
  assert.equal(S.parseSwissquote({ error: 'x' }).st, 'unavailable');
});

test('xaus.com: anlık ve 5 yıllık geçmiş', () => {
  const spot = S.parseXausSpot(fx('xaus_spot.json'));
  assert.equal(spot.XAU.v, 4195.600098);
  assert.equal(spot.XAG.v, 60.949001);
  const hist = S.parseXausHistory(fx('xaus_history.json'));
  assert.equal(hist[0][0], '2021-10-11');
  assert.equal(hist[0][1], 1755.7);
  assert.equal(hist.at(-1)[0], '2026-10-09');
});

test('Coinbase, Bitstamp, Binance: kripto fiyatları', () => {
  const t = S.parseCoinbaseTicker(fx('coinbase_ticker_btc.json'));
  assert.equal(t.v, 82932.79);
  assert.match(t.asOf, /^2026-10-11T07:54:08/);
  assert.equal(S.parseCoinbaseSpot(fx('coinbase_spot_btc.json'), NOW, 'BTC').v, 82931.145);
  assert.equal(S.parseCoinbaseSpot(fx('coinbase_spot_btc.json'), NOW, 'ETH').st, 'unavailable');
  assert.equal(S.parseBitstampTicker(fx('bitstamp_ticker_btc.json')).v, 82934.01);
  assert.equal(S.parseBinanceTicker(fx('binance_vision_ticker.json'), NOW).v, 83016.01);
});

test('günlük kripto serileri: Coinbase mumları ve Bitstamp OHLC', () => {
  const cb = S.parseCoinbaseCandles(fx('coinbase_candles_btc.json'));
  assert.equal(cb.length, 30);
  assert.equal(cb[0][0], '2026-10-11');
  assert.equal(cb[0][1], 82932.79);
  const bs = S.parseBitstampOhlc(fx('bitstamp_ohlc_btc.json'));
  assert.equal(bs[0][0], '2024-01-15');
  assert.equal(bs[0][1], 42493);
});

test('Frankfurter: TCMB kuru, altın ve gümüş serileri', () => {
  const tcmb = S.parseFrankfurterV2(fx('frankfurter_v2_tcmb.json'));
  assert.deepEqual(tcmb.at(-1), ['2026-10-09', 49.17095]);
  assert.ok(S.parseFrankfurterV2(fx('frankfurter_v2_xau.json')).length > 3);
  assert.ok(S.parseFrankfurterV2(fx('frankfurter_v2_xag.json')).every((p) => p[1] > 10 && p[1] < 200));
  const v1 = S.parseFrankfurterV1Series(fx('frankfurter_v1_series.json'), 'TRY');
  assert.deepEqual(v1[0], ['2026-09-01', 48.274]);
  assert.deepEqual(S.parseFrankfurterV2({ message: 'hata' }), []);
});

test('CoinGecko, currency-api ve TCMB XML', () => {
  const cg = S.parseCoinGeckoRates(fx('coingecko_rates.json'), NOW);
  assert.ok(cg.USDTRY.v > 49 && cg.USDTRY.v < 49.5);
  assert.ok(cg.XAU.v > 4150 && cg.XAU.v < 4250);
  assert.equal(S.parseCoinGeckoRates({}, NOW).USDTRY.st, 'unavailable');
  const ca = S.parseCurrencyApi(fx('currencyapi_latest.json'));
  assert.equal(ca.USDTRY.asOf, '2026-10-11T00:00:00.000Z');
  assert.ok(ca.XAU.v > 4150 && ca.XAU.v < 4250);
  assert.ok(ca.BTC.v > 80000);
  const tc = S.parseTcmbXml(fxText('tcmb_today.xml'));
  assert.equal(tc.v, Number(((49.1274 + 49.216) / 2).toFixed(6)));
  assert.equal(tc.asOf, '2026-10-09T12:30:00.000Z');
  assert.equal(S.parseTcmbXml('<html>bakım</html>').st, 'unavailable');
});

test('bozuk veri asla sayıya dönüşmez', () => {
  assert.equal(S.parseGoldApi({ symbol: 'XAU', price: 0, updatedAt: NOW }, 'XAU').st, 'unavailable');
  assert.equal(S.parseGoldApi({ symbol: 'XAU', price: 'abc', updatedAt: NOW }, 'XAU').st, 'unavailable');
  assert.equal(S.parseGoldApi(null, 'XAU').st, 'unavailable');
  assert.equal(S.parseCoinbaseTicker({ price: '-1', time: NOW }).st, 'unavailable');
  assert.deepEqual(S.parseXausHistory({ points: [{ d: '2026-01-01', c: null }, { d: 'dün', c: 5 }] }), []);
  assert.deepEqual(S.parseCoinbaseCandles([[null, 1, 2, 3, 4, 5], 'x']), []);
});
