import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Big } from '../../site/js/core/money.js';
import { okDatum, unavailable } from '../../site/js/core/datum.js';
import { getAsset, priceDecimals } from '../../site/js/core/assets.js';
import { buildMarket, unitUsdSeries } from '../../site/js/core/market.js';
import { parseCoinGeckoRates, parseCurrencyApi } from '../../site/js/core/sources.js';
import { tagAssets } from '../../site/js/core/news.js';
import { emptyPortfolio } from '../../site/js/core/portfolio.js';
import { planAlerts, emptyAlertState } from '../../site/js/core/alerts.js';
import { riskNote } from '../../site/js/core/scoring.js';
import { ROUND_TRIP_COST } from '../../site/js/core/backtest.js';
import { buildClaudePrompt } from '../../site/js/core/prompt.js';

const TUE = Date.parse('2026-10-13T08:00:00Z');
const SUN = Date.parse('2026-10-11T07:00:00Z');
const t = (ms) => new Date(ms - 5 * 60000).toISOString();
const live = (ms, over = {}) => ({
  XAU: okDatum(4000, t(ms), 'test'),
  XAG: okDatum(50, t(ms), 'test'),
  BTC: okDatum(80000, t(ms), 'test'),
  ETH: okDatum(3000, t(ms), 'test'),
  EUR: okDatum(1.0852, t(ms), 'Swissquote'),
  USDTRY: okDatum(49.27, t(ms), 'Swissquote'),
  ...over,
});
const history = { EURUSD: [['2026-10-09', 1.08], ['2026-10-12', 1.081]], USDTRY: [['2026-10-09', 49.1], ['2026-10-12', 49.2]] };

test('Euro: döviz türünde, 4 haneli fiyat, makul hedefler', () => {
  const e = getAsset('euro');
  assert.equal(e.kind, 'fx');
  assert.equal(e.symbol, 'EUR');
  assert.equal(priceDecimals(e), 4);
  assert.equal(priceDecimals(getAsset('btc')), 2);
  assert.ok(new Big(e.defaults.tp).lt(getAsset('gram-altin').defaults.tp), 'döviz daha az oynak: hedef daha dar');
  assert.equal(ROUND_TRIP_COST.fx, 0.01);
  assert.match(riskNote('fx'), /parite/);
});

test('Euro/TL = Euro/Dolar × Dolar/TL (kuruşu kuruşuna); kur yoksa uydurulmaz', () => {
  const m = buildMarket({ now: TUE, live: live(TUE), history });
  const e = m.assets.euro;
  assert.equal(e.usd.v, 1.0852);
  assert.equal(e.try.v, new Big('1.0852').times('49.27').round(4).toNumber());
  assert.equal(e.prevClose.date, '2026-10-12');
  assert.equal(e.prevClose.try, new Big('1.081').times('49.2').round(4).toNumber());
  assert.ok(e.change.tryPct > 0);
  const noFx = buildMarket({ now: TUE, live: live(TUE, { USDTRY: unavailable('-', 'zaman aşımı') }), history });
  assert.equal(noFx.assets.euro.try.st, 'unavailable');
  assert.equal(noFx.assets.euro.usd.v, 1.0852);
  const noEur = buildMarket({ now: TUE, live: live(TUE, { EUR: unavailable('tüm kaynaklar', 'HTTP 503') }), history });
  assert.equal(noEur.assets.euro.try.v, null);
  // Hafta sonu döviz piyasası kapalı
  assert.equal(buildMarket({ now: SUN, live: live(SUN), history }).assets.euro.marketOpen, false);
  // Analiz serisi parite (USD) üzerindendir
  assert.deepEqual(unitUsdSeries(getAsset('euro'), history), history.EURUSD);
});

test('Euro kaynak ayrıştırıcıları: CoinGecko ve currency-api', () => {
  const cg = parseCoinGeckoRates({ rates: { usd: { value: 110000 }, eur: { value: 101000 }, try: { value: 5420000 } } }, '2026-10-13T08:00:00Z');
  assert.ok(Math.abs(cg.EUR.v - 110000 / 101000) < 1e-9);
  const ca = parseCurrencyApi({ date: '2026-10-13', usd: { eur: 0.92, try: 49.2 } });
  assert.ok(Math.abs(ca.EUR.v - 1 / 0.92) < 1e-9);
  assert.equal(parseCurrencyApi({ date: '2026-10-13', usd: { try: 49.2 } }).EUR.st, 'unavailable');
});

test('Euro haberleri: kur bağlamı gerekir, spor haberleri karışmaz', () => {
  assert.deepEqual(tagAssets('Euro dolar karşısında geriledi'), ['euro']);
  assert.deepEqual(tagAssets('Euro/TL 53 lirayı aştı'), ['euro']);
  assert.deepEqual(tagAssets('EUR/USD rises after ECB decision'), ['euro']);
  assert.deepEqual(tagAssets('Avrupa Merkez Bankası faiz kararını açıkladı'), ['euro']);
  assert.deepEqual(tagAssets('Euro 2028 elemelerinde Türkiye kazandı'), []);
  assert.deepEqual(tagAssets('Euroleague: Fenerbahçe kazandı'), []);
});

test('Euro pozisyonu için kâr hedefi uyarısı; mesajda € birimi', () => {
  const m = buildMarket({ now: TUE, live: live(TUE), history });
  const price = new Big(String(m.assets.euro.try.v));
  const portfolio = { ...emptyPortfolio(), tx: [{ id: 'e1', type: 'buy', asset: 'euro', date: '2026-01-05', qty: '1000', amountTry: price.times('1000').div('1.12').toFixed(2), feeTry: '0', createdAt: '2026-01-05T10:00:00Z' }] };
  const plan = planAlerts({ portfolio, market: m, now: TUE, state: emptyAlertState() });
  assert.deepEqual(plan.messages.map((x) => x.kind), ['tp']);
  assert.match(plan.messages[0].text, /Euro: Kâr hedefine ulaşıldı/);
  assert.match(plan.messages[0].text, /Elindeki: 1\.000 €/);
  assert.match(plan.messages[0].text, /TL\/€/);
});

test("Claude'a sor: Euro satırı parite ve 4 haneli kurla", () => {
  const m = buildMarket({ now: TUE, live: live(TUE), history });
  const line = buildClaudePrompt({ market: m, now: TUE }).split('\n').find((l) => l.startsWith('- Euro:'));
  assert.match(line, /53,4678 TL\/€/);
  assert.match(line, /1 € = \$1,0852/);
});

test('Dolar: fiyatı Dolar/TL kuru, dolar fiyatı her zaman 1; analiz kur üzerinden', async () => {
  const { analyzeMarket } = await import('../../site/js/core/analysis.js');
  const d = getAsset('dolar');
  assert.equal(d.kind, 'fx');
  const m = buildMarket({ now: TUE, live: live(TUE), history });
  assert.equal(m.assets.dolar.try.v, 49.27);
  assert.equal(m.assets.dolar.usd.v, 1);
  assert.equal(m.assets.dolar.prevClose.try, 49.2);
  // Kur yoksa Dolar'ın TL fiyatı da yok (uydurulmaz)
  assert.equal(buildMarket({ now: TUE, live: live(TUE, { USDTRY: unavailable('-', 'zaman aşımı') }), history }).assets.dolar.try.st, 'unavailable');
  // 300 günlük yükselen kur serisiyle analiz: etiket üretilir, "Dolar/TL trendi" göstergesi kullanılmaz
  const days = [];
  for (let i = 0; i < 300; i++) days.push([new Date(Date.UTC(2025, 11, 1) + i * 86400000).toISOString().slice(0, 10), 40 + i * 0.03]);
  const series = { USDTRY: days, EURUSD: days.map(([dd]) => [dd, 1.1]) };
  const mm = buildMarket({ now: TUE, live: live(TUE), history: series });
  analyzeMarket(mm, series);
  const an = mm.assets.dolar.analysis;
  assert.ok(['buy', 'wait', 'expensive', 'none'].includes(an.label));
  assert.equal(an.factors.find((f) => f.id === 'fx').score, null);
  assert.equal(an.indicators.price, 49.27, 'analiz fiyatı TL kurudur');
  const line = buildClaudePrompt({ market: mm, now: TUE }).split('\n').find((l) => l.startsWith('- Dolar:'));
  assert.match(line, /49,2700 TL\/\$; kur: Swissquote/);
});

test('Dolar haberleri: dolar başka varlığın birimiyse sayılmaz', () => {
  assert.deepEqual(tagAssets('Dolar/TL rekor kırdı'), ['dolar']);
  assert.deepEqual(tagAssets('Altın ons başına 4.200 dolara çıktı'), ['gram-altin']);
  assert.deepEqual(tagAssets('Euro dolar karşısında geriledi'), ['euro']);
});

test('risk notu varlığa göre: Dolar ve Euro ayrı', () => {
  assert.match(riskNote('fx', 'USD'), /Dolar/);
  assert.doesNotMatch(riskNote('fx', 'USD'), /Euro/);
  assert.match(riskNote('fx', 'EUR'), /Euro/);
});
