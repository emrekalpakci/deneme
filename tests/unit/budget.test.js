import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Big } from '../../site/js/core/money.js';
import { BASE, LIMITS, PLAN_ASSETS, CASH, targetWeights, allocate, roundingStep, monthlyPlan } from '../../site/js/core/budget.js';
import { alignWeekly, lumpSumScenarios, monthlyBuyScenarios, percentile } from '../../site/js/core/scenarios.js';
import { addDays } from '../../site/js/core/series.js';

const PROFILES = [];
for (const horizon of ['short', 'long']) for (const risk of ['low', 'medium', 'high']) PROFILES.push({ horizon, risk });

test('başlangıç tabloları 100\'e tamamlanır ve sınırlara uyar', () => {
  for (const { horizon, risk } of PROFILES) {
    const b = BASE[horizon][risk];
    assert.equal([CASH, ...PLAN_ASSETS].reduce((s, a) => s + b[a], 0), 100, `${horizon}/${risk}`);
    assert.ok(b.btc + b.eth <= LIMITS.cryptoMax);
    for (const a of PLAN_ASSETS) assert.ok(b[a] <= LIMITS.singleAssetMax);
  }
  assert.equal(BASE.short.low.btc + BASE.short.low.eth, 0, 'kısa vade + düşük risk: kripto yok');
});

test('yuvarlama adımı bütçeye göre', () => {
  assert.equal(roundingStep('50000').toString(), '100');
  assert.equal(roundingStep('5000').toString(), '10');
  assert.equal(roundingStep('999').toString(), '1');
  assert.equal(roundingStep('2500000').toString(), '1000');
});

test('1.000 rastgele bütçe × 6 profil: toplam tam, sınırlar korunur', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1000; i++) {
    const budget = new Big(String(Math.floor(rnd() * 5_000_000_00) + 1)).div('100'); // 0,01 – 5.000.000 TL, kuruşlu
    for (const p of PROFILES) {
      const { weights } = targetWeights(p);
      const r = allocate(budget.toString(), weights);
      const sum = r.parts.reduce((s, x) => s.plus(x.amount), r.cash);
      assert.ok(sum.eq(budget), `toplam ${sum} ≠ ${budget}`);
      assert.ok(r.cash.gte('0'));
      let crypto = new Big('0');
      for (const part of r.parts) {
        assert.ok(part.amount.gt('0'));
        assert.ok(part.amount.mod(r.step).eq('0'), 'parça adımın katı');
        assert.ok(part.amount.gte(r.minPart), 'çok küçük parça yok');
        assert.ok(part.amount.lte(budget.times(String(LIMITS.singleAssetMax)).div('100')), 'tek varlık ≤ %60');
        if (part.asset === 'btc' || part.asset === 'eth') crypto = crypto.plus(part.amount);
      }
      assert.ok(crypto.lte(budget.times(String(LIMITS.cryptoMax)).div('100')), 'kripto ≤ %40');
      if (p.horizon === 'short' && p.risk === 'low') assert.ok(crypto.eq('0'));
    }
  }
});

test('örnek: 50.000 TL, uzun vade, orta risk', () => {
  const r = allocate('50000', targetWeights({ horizon: 'long', risk: 'medium' }).weights);
  const m = Object.fromEntries(r.parts.map((p) => [p.asset, p.amount.toString()]));
  assert.deepEqual(m, { 'gram-altin': '27500', 'gram-gumus': '5000', btc: '8500', eth: '4000' });
  assert.equal(r.cash.toString(), '5000');
});

test('küçük bütçede küçük parçalar nakitte kalır', () => {
  const r = allocate('1000', targetWeights({ horizon: 'long', risk: 'high' }).weights);
  assert.ok(r.parts.every((p) => p.amount.gte('250')));
  assert.ok(!r.parts.some((p) => p.asset === 'eth'), '130 TL ETH payı 250 TL altında → nakit');
  const tiny = allocate('100', targetWeights({ horizon: 'long', risk: 'high' }).weights);
  assert.equal(tiny.parts.length, 0);
  assert.equal(tiny.cash.toString(), '100');
});

test('etiket ayarı: "pahalı" payı azaltır, fark nakite geçer; yukarı ayar nakdi azaltmaz', () => {
  const base = targetWeights({ horizon: 'long', risk: 'medium' }).weights;
  const t = targetWeights({ horizon: 'long', risk: 'medium', labels: { btc: 'expensive', 'gram-altin': 'buy' } }).weights;
  assert.ok(t.btc < base.btc);
  assert.ok(t[CASH] >= BASE.long.medium[CASH] - 1e-9);
  assert.ok(t['gram-altin'] <= LIMITS.singleAssetMax);
  const sum = [CASH, ...PLAN_ASSETS].reduce((s, a) => s + t[a], 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
  const none = targetWeights({ horizon: 'long', risk: 'medium', labels: { eth: 'none' } }).weights;
  assert.equal(none.eth, 0);
});

test('fiyatı olmayan varlık plana girmez, nedeni yazılır', () => {
  const { weights, notes } = targetWeights({ horizon: 'long', risk: 'high', available: { btc: false } });
  assert.equal(weights.btc, 0);
  assert.equal(notes[0].asset, 'btc');
});

test('aylık plan: her ay eşit, toplamlar kuruşu kuruşuna tutar', () => {
  const parts = [
    { asset: 'gram-altin', amount: new Big('27500') },
    { asset: 'btc', amount: new Big('8500') },
  ];
  for (const n of [6, 12, 24]) {
    const rows = monthlyPlan(parts, n);
    assert.equal(rows.length, n);
    for (const p of parts) {
      const sum = rows.reduce((s, r) => s.plus(r.amounts[p.asset]), new Big('0'));
      assert.ok(sum.eq(p.amount), `${p.asset} ${n} ay`);
    }
  }
  const r12 = monthlyPlan(parts, 12);
  assert.equal(r12[0].amounts['gram-altin'].toString(), '2291.66');
  assert.equal(r12[11].amounts['gram-altin'].toString(), '2291.74');
});

// --- Senaryolar (yapay seriyle, sonucu elle bilinen) ---------------------------------

function series(days, fn) {
  const out = [];
  let d = '2018-01-01';
  for (let i = 0; i < days; i++) {
    out.push([d, fn(i)]);
    d = addDays(d, 1);
  }
  return out;
}

test('yüzdelik dilim hesabı', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(percentile([0, 10], 0.1), 1);
});

test('sabit büyüyen seride senaryolar beklenen getiriyi verir', () => {
  // Her 5 günde %1 artan fiyat: 26 adımda (1,01^26 − 1) ≈ %29,5 getiri.
  const a = series(5 * 300, (i) => 100 * 1.01 ** (i / 5));
  const aligned = alignWeekly({ x: a });
  const s = lumpSumScenarios({ x: 0.5 }, aligned, 26);
  assert.equal(s.available, true);
  const expected = 0.5 * (1.01 ** 26 - 1);
  assert.ok(Math.abs(s.mid - expected) < 1e-9);
  assert.ok(Math.abs(s.bad - expected) < 1e-9);
  assert.equal(s.lossShare, 0);
});

test('dalgalı seride kötü < orta < iyi; zarar oranı 0 ile 1 arasında', () => {
  const a = series(5 * 400, (i) => 100 * (1 + 0.3 * Math.sin(i / 60)) * 1.0005 ** i);
  const b = series(5 * 400, (i) => 50 * (1 + 0.1 * Math.cos(i / 90)));
  const aligned = alignWeekly({ a, b });
  const s = lumpSumScenarios({ a: 0.4, b: 0.4 }, aligned, 52);
  assert.ok(s.bad < s.mid && s.mid < s.good);
  assert.ok(s.lossShare > 0 && s.lossShare < 1);
  const m = monthlyBuyScenarios({ a: 0.4, b: 0.4 }, aligned, 12);
  assert.equal(m.available, true);
  assert.ok(m.bad <= m.mid && m.mid <= m.good);
});

test('2 yıldan az ortak veri: senaryo "yok" ve nedeni', () => {
  const a = series(300, () => 1);
  const s = lumpSumScenarios({ a: 1 }, alignWeekly({ a }), 26);
  assert.equal(s.available, false);
  assert.match(s.why, /2 yıldan az/);
});

test('ortak gün: bir varlığın olmadığı günler atlanır', () => {
  const a = [['2026-01-01', 1], ['2026-01-02', 2], ['2026-01-03', 3]];
  const b = [['2026-01-02', 5], ['2026-01-03', 6]];
  const al = alignWeekly({ a, b });
  assert.deepEqual(al.dates, ['2026-01-03']);
});

test('dolar bazına çevirme: TL artışı sadece kurdan geliyorsa dolar getirisi 0', async () => {
  const { toUsdAligned } = await import('../../site/js/core/scenarios.js');
  const fx = series(5 * 300, (i) => 10 * 1.002 ** i);
  const a = series(5 * 300, (i) => 1000 * 1.002 ** i); // TL'de kur kadar artıyor
  const aligned = alignWeekly({ a, USDTRY: fx });
  const tl = lumpSumScenarios({ a: 1 }, aligned, 26);
  const usd = lumpSumScenarios({ a: 1 }, toUsdAligned(aligned), 26);
  const bench = lumpSumScenarios({ USDTRY: 1 }, aligned, 26);
  assert.ok(tl.mid > 0.2);
  assert.ok(Math.abs(usd.mid) < 1e-9);
  assert.ok(Math.abs(bench.mid - tl.mid) < 1e-9);
});

test('bütçe ayarı: düşük güvenli "alım" payı artırmaz, "pahalı" her zaman azaltır', async () => {
  const { tiltLabel } = await import('../../site/js/core/budget.js');
  assert.equal(tiltLabel({ label: 'buy', confidence: { level: 'low' } }), 'wait');
  assert.equal(tiltLabel({ label: 'buy', confidence: { level: 'medium' } }), 'buy');
  assert.equal(tiltLabel({ label: 'expensive', confidence: { level: 'low' } }), 'expensive');
  assert.equal(tiltLabel({ label: 'none', confidence: null }), 'none');
  assert.equal(tiltLabel(null), 'none');
});
