import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Big } from '../../site/js/core/money.js';
import { scoreFactors, confidence, technicalSeries, technicalFactorsAt, fxFactor, FACTORS, RULES, reasonSentences } from '../../site/js/core/scoring.js';
import { backtestAsset, labelSeries, forwardReturns, wilson } from '../../site/js/core/backtest.js';
import { analyzeAsset, trendEvents } from '../../site/js/core/analysis.js';
import { positionSignals } from '../../site/js/core/signals.js';
import { addDays } from '../../site/js/core/series.js';
import { getAsset } from '../../site/js/core/assets.js';

const f = (score, raw = {}) => ({ score, raw });

test('ağırlıklar toplamı 1', () => {
  assert.ok(Math.abs(FACTORS.reduce((s, x) => s + x.weight, 0) - 1) < 1e-12);
});

test('toplam puan ağırlıklı ortalamadır; katkılar toplama eşit', () => {
  const r = scoreFactors({ trend: f(100), rsi: f(0), peak: f(-50), vol: f(20), fx: f(30), news: f(null) });
  const expected = (0.3 * 100 + 0 + 0.15 * -50 + 0.15 * 20 + 0.1 * 30) / 0.9;
  assert.ok(Math.abs(r.total - expected) < 1e-9);
  const sum = r.rows.filter((x) => x.contribution !== null).reduce((s, x) => s + x.contribution, 0);
  assert.ok(Math.abs(sum - r.total) < 1e-9);
  assert.equal(r.rows.find((x) => x.id === 'news').contribution, null, 'eksik faktör katkı vermez');
});

test('etiket öncelikleri', () => {
  const all = (o) => ({ trend: f(100), rsi: f(0), peak: f(0), vol: f(0), fx: f(0), news: f(0), ...o });
  assert.equal(scoreFactors(all({ rsi: f(-100), peak: f(-50) })).label, 'expensive', 'RSI aşırı + zirvede → pahalı (trend iyi olsa da)');
  assert.equal(scoreFactors(all({})).label, 'buy');
  assert.equal(scoreFactors(all({ trend: f(-100), rsi: f(100), peak: f(100) })).label, 'wait', 'düşüş trendinde ucuz görünse de alım denmez');
  assert.equal(scoreFactors(all({ trend: f(0), rsi: f(0) })).label, 'wait');
  assert.equal(scoreFactors(all({ trend: f(null) })).label, 'none', 'trend yoksa veri yetersiz');
  assert.equal(scoreFactors(all({}), { stale: true }).label, 'none', 'eski fiyatla değerlendirme yapılmaz');
  assert.equal(scoreFactors({ trend: f(100), rsi: f(0), peak: f(null), vol: f(null), fx: f(null), news: f(null) }).label, 'none', 'ağırlığın %70\'inden azı');
});

test('güven: eşiğe yakınlık, sert oynaklık ve zayıf kanıt güveni düşürür; bekle asla yüksek değil', () => {
  const factors = { trend: f(100), rsi: f(60), peak: f(40), vol: f(50, { rank: 0.3 }), fx: f(20), news: f(null) };
  const r = scoreFactors(factors);
  const strongBt = { nInd: 20, edgePp: 15, ciLow: 0.7, baseline: 0.55 };
  assert.equal(confidence({ ...r, stale: false, factors, kind: 'metal', bt: strongBt }).level, 'high');
  assert.equal(confidence({ ...r, stale: false, factors, kind: 'crypto', bt: strongBt }).level, 'medium', 'kripto en fazla orta');
  assert.equal(confidence({ ...r, stale: false, factors, kind: 'metal', bt: { ...strongBt, nInd: 5 } }).level, 'low');
  const sharp = { ...factors, vol: f(-80, { rank: 0.9 }) };
  assert.equal(confidence({ ...scoreFactors(sharp), stale: false, factors: sharp, kind: 'metal', bt: strongBt }).level, 'low');
  const waitF = { trend: f(0), rsi: f(0), peak: f(0), vol: f(0, { rank: 0.5 }), fx: f(0), news: f(0) };
  const w = scoreFactors(waitF);
  assert.equal(w.label, 'wait');
  assert.notEqual(confidence({ ...w, stale: false, factors: waitF, kind: 'metal', bt: strongBt }).level, 'high');
});

test('gerekçe: en etkili iki faktör + sonuç cümlesi', () => {
  const factors = { trend: f(100, {}), rsi: f(-100, { rsi: 75 }), peak: f(-50, { drawdown: 0 }), vol: f(0, { rank: 0.5 }), fx: f(0, { change3m: 0.03 }), news: f(null) };
  const r = scoreFactors(factors);
  const s = reasonSentences(r, factors);
  assert.equal(s.length, 3);
  assert.match(s[0], /200 günlük/);
  assert.match(s[1], /RSI 75/);
});

test('kur faktörü: 3 ayda %3 nötr, daha hızlı artış olumlu', () => {
  const series = (c) => Array.from({ length: 70 }, (_, i) => 40 * (1 + (c * Math.max(0, i - 6)) / 63));
  assert.ok(Math.abs(fxFactor(series(0.03)).score) < 1e-6);
  assert.ok(fxFactor(series(0.08)).score > 40);
  assert.equal(fxFactor([1, 2]).score, null);
});

// --- Gerçekçi yapay seriler -----------------------------------------------------------

function synth(n, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts = [];
  let d = '2018-01-01';
  let v = 100;
  for (let i = 0; i < n; i++) {
    v *= 1 + 0.0004 + (rnd() - 0.5) * 0.03 + 0.01 * Math.sin(i / 90);
    pts.push([d, v]);
    d = addDays(d, 1);
  }
  return pts;
}

test('geçmiş test: geleceğe bakmaz — sonraki veriyi değiştirmek önceki etiketleri değiştirmez', () => {
  const a = synth(1500).map((p) => p[1]);
  const b = [...a.slice(0, 1000), ...a.slice(1000).map((x) => x * 5)];
  const la = labelSeries(a, 'crypto').labels;
  const lb = labelSeries(b, 'crypto').labels;
  for (let i = 0; i < 1000; i++) assert.equal(la[i], lb[i], `gün ${i}`);
});

test('ileri getiri 90 takvim günü sonrasına göre; sonda pencere tamamlanmazsa null', () => {
  const dates = ['2026-01-01', '2026-03-01', '2026-04-01', '2026-04-02'];
  const r = forwardReturns(dates, [100, 110, 120, 130]);
  assert.equal(r[0], 120 / 100 - 1, '1 Ocak + 90 gün = 1 Nisan');
  assert.equal(r[2], null);
});

test('Wilson aralığı bilinen değer', () => {
  const [lo, hi] = wilson(7, 10);
  assert.ok(Math.abs(lo - 0.3968) < 0.001 && Math.abs(hi - 0.8922) < 0.001);
  assert.deepEqual(wilson(0, 0), [null, null]);
});

test('geçmiş test sonucu tutarlı ve maliyet dahil', () => {
  const bt = backtestAsset(synth(2500), 'crypto');
  assert.equal(bt.available, true);
  assert.ok(bt.baseline.up > 0 && bt.baseline.up < 1);
  assert.equal(bt.counts.buy + bt.counts.wait + bt.counts.expensive, bt.days);
  assert.ok(bt.buy.nInd <= bt.buy.days);
  if (bt.buy.days) assert.ok(Math.abs(bt.buy.edgePp - (bt.buy.hit - bt.baseline.up) * 100) < 1e-9);
  assert.ok(bt.hold.maxDD <= 0 && bt.timing.maxDD <= 0);
  const short = backtestAsset(synth(300), 'crypto');
  assert.equal(short.available, false);
});

test('sürekli yükselen seride al-tut tabanı %100, kanıt sayısı bağımsız sinyallerden', () => {
  const pts = Array.from({ length: 1200 }, (_, i) => [addDays('2020-01-01', i), 100 * 1.001 ** i * (1 + 0.004 * Math.sin(i))]);
  const bt = backtestAsset(pts, 'crypto');
  assert.equal(bt.baseline.up, 1);
});

test('güncel analiz: etiket, gerekçe, göstergeler ve eski veri', () => {
  const btc = getAsset('btc');
  const pts = synth(1200);
  const fx = pts.map(([d], i) => [d, 30 * 1.0005 ** i]);
  const a = analyzeAsset({ asset: btc, points: pts, fxPoints: fx });
  assert.ok(['buy', 'wait', 'expensive'].includes(a.label));
  assert.ok(a.reasons.length >= 2 && a.reasons.length <= 3);
  assert.equal(a.factors.length, 6);
  assert.ok(a.indicators.ma200 > 0 && a.indicators.rsi >= 0 && a.indicators.rsi <= 100);
  assert.equal(analyzeAsset({ asset: btc, points: pts, fxPoints: fx, stale: true }).label, 'none');
  assert.equal(analyzeAsset({ asset: btc, points: pts.slice(0, 20) }).label, 'none');
});

test('trend olayları: 200 günlük ortalamanın altına iniş', () => {
  const vals = [...Array.from({ length: 250 }, (_, i) => 100 + i * 0.2), 80];
  const dates = vals.map((_, i) => addDays('2025-01-01', i));
  const t = technicalSeries(vals, 'metal');
  const ev = trendEvents(dates, vals, t);
  assert.deepEqual(ev.map((e) => e.type), ['below200']);
  assert.equal(ev[0].date, dates.at(-1));
});

test('satış sinyalleri: hedef, iki kat, zarar sınırı, yaklaşma ve trend', () => {
  const avg = new Big('100');
  const types = (price, events) => positionSignals({ avgCost: avg, price, tp: '15', sl: '8', events }).signals.map((s) => s.type);
  assert.deepEqual(types(110), []);
  assert.deepEqual(types(113), ['tpNear']);
  assert.deepEqual(types(115), ['tp']);
  assert.deepEqual(types(131), ['tp2']);
  assert.deepEqual(types(93), ['slNear']);
  assert.deepEqual(types(92), ['sl']);
  assert.deepEqual(types(105, [{ type: 'below200', date: '2026-10-09' }]), ['trend']);
  assert.equal(positionSignals({ avgCost: avg, price: null, tp: '15', sl: '8' }).plPct, null, 'fiyat yoksa sinyal yok');
  assert.equal(positionSignals({ avgCost: avg, price: 115, tp: '15', sl: '8' }).plPct.toString(), '15');
});

test('kural sabitleri belgelenen değerlerde', () => {
  assert.deepEqual({ ...RULES }, { buyMin: 25, expensiveMax: -60, minWeight: 0.7, fxNeutral: 0.03 });
});

test('teknik faktörler: zirvede pahalı, düşüşte ucuz', () => {
  const up = Array.from({ length: 400 }, (_, i) => 100 * 1.002 ** i * (1 + 0.01 * Math.sin(i / 3)));
  const t = technicalSeries(up, 'crypto');
  const atPeak = technicalFactorsAt(up, t, up.length - 1);
  assert.equal(atPeak.trend.score, 100);
  const down = [...up, ...Array.from({ length: 30 }, (_, i) => up.at(-1) * 0.97 ** (i + 1))];
  const t2 = technicalSeries(down, 'crypto');
  const fallen = technicalFactorsAt(down, t2, down.length - 1);
  assert.ok(fallen.peak.score > atPeak.peak.score, 'zirveden uzaklaştıkça puan artar');
  assert.ok(fallen.rsi.score > 50, 'sert düşüşte RSI düşük → olumlu puan');
});

test('piyasa özetine analiz eklenir; canlı fiyat yoksa etiket "Veri yetersiz"', async () => {
  const { buildMarket } = await import('../../site/js/core/market.js');
  const { analyzeMarket } = await import('../../site/js/core/analysis.js');
  const { okDatum, unavailable } = await import('../../site/js/core/datum.js');
  const pts = synth(1300);
  const weekdays = pts.filter(([d]) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const history = { XAUUSD: weekdays.map(([d, v]) => [d, v * 30]), XAGUSD: weekdays, USDTRY: weekdays.map(([d], i) => [d, 30 + i * 0.01]), BTCUSD: pts, ETHUSD: pts };
  const now = Date.parse(`${pts.at(-1)[0]}T12:00:00Z`);
  const t = new Date(now - 60000).toISOString();
  const live = { XAU: okDatum(weekdays.at(-1)[1] * 30, t, 'a'), XAG: okDatum(weekdays.at(-1)[1], t, 'a'), BTC: okDatum(pts.at(-1)[1], t, 'c'), ETH: unavailable('c', 'HTTP 503'), USDTRY: okDatum(43, t, 's') };
  const m = analyzeMarket(buildMarket({ now, live, history }), history);
  assert.ok(['buy', 'wait', 'expensive'].includes(m.assets.btc.analysis.label));
  assert.equal(m.assets.btc.backtest.available, true);
  assert.equal(m.assets.eth.analysis.label, 'none');
  assert.equal(m.assets.eth.analysis.labelText, 'Veri yetersiz');
});
