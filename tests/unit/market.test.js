import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarket, tradingDate, prevClose, toTrySeries } from '../../site/js/core/market.js';
import { okDatum, unavailable } from '../../site/js/core/datum.js';
import { isFxMetalOpen } from '../../site/js/core/market-hours.js';
import { Big } from '../../site/js/core/money.js';

// Pazar 11 Ekim 2026 10:00 TSİ (07:00 UTC) — metal ve döviz piyasası kapalı.
const SUNDAY = Date.parse('2026-10-11T07:00:00Z');
// Salı 13 Ekim 2026 14:00 TSİ (11:00 UTC) — piyasa açık.
const TUESDAY = Date.parse('2026-10-13T11:00:00Z');

const history = {
  XAUUSD: [
    ['2026-10-08', 4150],
    ['2026-10-09', 4200],
  ],
  XAGUSD: [
    ['2026-10-08', 60],
    ['2026-10-09', 61],
  ],
  USDTRY: [
    ['2026-10-08', 49.1],
    ['2026-10-09', 49.2],
  ],
  BTCUSD: [
    ['2026-10-09', 80000],
    ['2026-10-10', 82000],
  ],
  ETHUSD: [
    ['2026-10-09', 2400],
    ['2026-10-10', 2450],
  ],
};

function liveAt(ms, overrides = {}) {
  const t = new Date(ms - 60_000).toISOString();
  return {
    XAU: okDatum(4195.6, t, 'gold-api.com'),
    XAG: okDatum(60.95, t, 'gold-api.com'),
    BTC: okDatum(82900, t, 'Coinbase'),
    ETH: okDatum(2499, t, 'Coinbase'),
    EUR: okDatum(1.0852, t, 'Swissquote'),
    USDTRY: okDatum(49.27, t, 'Swissquote'),
    ...overrides,
  };
}

test('piyasa saatleri: hafta sonu kapalı, hafta içi açık', () => {
  assert.equal(isFxMetalOpen(SUNDAY), false);
  assert.equal(isFxMetalOpen(TUESDAY), true);
  assert.equal(isFxMetalOpen(Date.parse('2026-10-11T23:00:00Z')), true, 'Pazar 19:00 New York açılış');
  assert.equal(isFxMetalOpen(Date.parse('2026-10-09T21:30:00Z')), false, 'Cuma 17:30 New York kapalı');
});

test('işlem günü: hafta sonu Cuma seansına, akşam 18:00 sonrası ertesi güne yazılır', () => {
  assert.equal(tradingDate('metal', SUNDAY), '2026-10-09');
  assert.equal(tradingDate('metal', TUESDAY), '2026-10-13');
  assert.equal(tradingDate('metal', Date.parse('2026-10-13T22:30:00Z')), '2026-10-14');
  assert.equal(tradingDate('crypto', SUNDAY), '2026-10-11');
  assert.deepEqual(prevClose(history.XAUUSD, '2026-10-09'), ['2026-10-08', 4150]);
  assert.equal(prevClose(history.XAUUSD, '2026-10-08'), null);
});

test('TL serisi: kur olmayan günler atlanır, uydurulmaz', () => {
  const s = toTrySeries([['2026-10-01', 100], ['2026-10-09', 100], ['2026-10-10', 100]], history.USDTRY);
  assert.deepEqual(s, [
    ['2026-10-09', 4920],
    ['2026-10-10', 4920],
  ]);
});

test('Pazar: metaller "piyasa kapalı", eski sayılmaz; değişim Cuma\'ya göre', () => {
  const m = buildMarket({ now: SUNDAY, live: liveAt(SUNDAY), history });
  const gold = m.assets['gram-altin'];
  assert.equal(gold.marketOpen, false);
  assert.equal(gold.try.st, 'ok');
  const expected = new Big('4195.6').times('49.27').div('31.1035').round(4).toNumber();
  assert.equal(gold.try.v, expected);
  assert.equal(gold.prevClose.date, '2026-10-08', 'hafta sonu fiyatı Cuma seansıdır; önceki kapanış Perşembe');
  assert.ok(gold.change.usdPct !== null);
  assert.equal(m.assets.btc.marketOpen, true);
  assert.equal(m.assets.btc.prevClose.date, '2026-10-10');
  assert.equal(m.fx.USDTRY.marketOpen, false);
});

test('Salı: 3 saatlik metal fiyatı "eski" işaretlenir ama değeri saklanmaz', () => {
  const old = new Date(TUESDAY - 3 * 3600e3).toISOString();
  const m = buildMarket({ now: TUESDAY, live: liveAt(TUESDAY, { XAU: okDatum(4195.6, old, 'gold-api.com') }), history });
  assert.equal(m.assets['gram-altin'].ounceUsd.st, 'stale');
  assert.equal(m.assets['gram-altin'].try.st, 'stale');
  assert.equal(m.assets['gram-gumus'].try.st, 'ok');
});

test('kur alınamazsa TL fiyatları "yok", USD fiyatları durur', () => {
  const m = buildMarket({ now: TUESDAY, live: liveAt(TUESDAY, { USDTRY: unavailable('tüm kaynaklar', 'zaman aşımı') }), history });
  for (const a of Object.values(m.assets)) {
    assert.equal(a.try.st, 'unavailable', `${a.id} TL fiyatı uydurulmamalı`);
    assert.equal(a.try.v, null);
    assert.equal(a.change.tryPct, null);
    assert.equal(a.usd.st, 'ok');
  }
});

test('bir varlığın fiyatı yoksa sadece o varlık etkilenir', () => {
  const m = buildMarket({ now: TUESDAY, live: liveAt(TUESDAY, { ETH: unavailable('tüm kaynaklar', 'HTTP 503') }), history });
  assert.equal(m.assets.eth.usd.st, 'unavailable');
  assert.equal(m.assets.eth.try.st, 'unavailable');
  assert.equal(m.assets.eth.change.usdPct, null);
  assert.equal(m.assets.btc.usd.st, 'ok');
  assert.ok(m.assets.eth.spark.try.every((v) => typeof v === 'number'), 'grafikte sadece gerçek kapanışlar');
});

test('geçmiş yoksa değişim ve grafik boş kalır', () => {
  const m = buildMarket({ now: TUESDAY, live: liveAt(TUESDAY), history: {} });
  const gold = m.assets['gram-altin'];
  assert.equal(gold.prevClose, null);
  assert.equal(gold.change.usdPct, null);
  assert.equal(gold.spark.try.length, 1, 'sadece bugünkü canlı fiyat');
});

test('tarayıcıdaki canlı fiyat: TL yeniden hesaplanır, doğrulanmamış sıçrama yok sayılır', async () => {
  const { applyLivePrices } = await import('../../site/js/core/market.js');
  const m = buildMarket({ now: TUESDAY, live: liveAt(TUESDAY), history });
  const t = new Date(TUESDAY).toISOString();
  const out = applyLivePrices(m, { XAU: okDatum(4250, t, 'gold-api.com'), BTC: okDatum(200000, t, 'Coinbase') }, TUESDAY);
  const gold = out.assets['gram-altin'];
  assert.equal(gold.ounceUsd.v, 4250);
  assert.equal(gold.try.v, new Big('4250').times('49.27').div('31.1035').round(4).toNumber());
  assert.ok(gold.live, 'canlı işaretlenir');
  assert.equal(gold.spark.try.at(-1), gold.try.v, 'grafiğin son noktası canlı fiyat');
  assert.equal(out.assets.btc.usd.v, 82900, '%140 sıçrama doğrulanmadığı için yok sayılır');
  assert.equal(out.assets.btc.live, undefined);
  assert.equal(m.assets['gram-altin'].ounceUsd.v, 4195.6, 'asıl özet değişmez');
});
