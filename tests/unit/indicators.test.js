import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smaSeries, rsiSeries, rollingMaxSeries, volatilitySeries, percentRankSeries, changeSeries } from '../../site/js/core/indicators.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);

test('SMA', () => {
  assert.deepEqual(smaSeries([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('RSI: Wilder\'ın klasik örnek verisi', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  const rsi = rsiSeries(closes, 14);
  assert.equal(rsi[13], null);
  // Yuvarlamasız tam değerler (bağımsız Python hesabıyla aynı):
  const exact = [70.4641, 66.2496, 66.4809, 69.3469, 66.2947, 57.915];
  exact.forEach((v, k) => near(rsi[14 + k], v, 0.0001, `RSI[${14 + k}]`));
  // StockCharts tablosu ara değerleri yuvarladığı için ±0,1 içinde:
  [70.53, 66.32, 66.55, 69.41, 66.36, 57.97].forEach((v, k) => near(rsi[14 + k], v, 0.1, `tablo[${k}]`));
});

test('RSI uç durumlar: hep yükselen 100, hep düşen 0, düz 50', () => {
  assert.equal(rsiSeries(Array.from({ length: 20 }, (_, i) => 10 + i), 14).at(-1), 100);
  assert.equal(rsiSeries(Array.from({ length: 20 }, (_, i) => 30 - i), 14).at(-1), 0);
  assert.equal(rsiSeries(Array(20).fill(5), 14).at(-1), 50);
});

test('kayan en yüksek değer', () => {
  assert.deepEqual(rollingMaxSeries([1, 3, 2, 5, 4, 1], 3), [null, null, 3, 5, 5, 5]);
});

test('oynaklık: sabit büyümede 0, dalgalıda pozitif', () => {
  const steady = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i);
  near(volatilitySeries(steady, 20, 252).at(-1), 0, 1e-9);
  const wavy = Array.from({ length: 30 }, (_, i) => 100 * (i % 2 ? 1.02 : 0.98));
  assert.ok(volatilitySeries(wavy, 20, 252).at(-1) > 0.3);
});

test('yüzdelik sıra ve değişim', () => {
  const pr = percentRankSeries([1, 2, 3, 4, 0.5], 10, 3);
  assert.deepEqual(pr, [null, null, null, 1, 0]);
  assert.deepEqual(changeSeries([100, 110, 121], 1).map((x) => x && Number(x.toFixed(10))), [null, 0.1, 0.1]);
});

test('nedensellik: sonraki veriyi değiştirmek önceki göstergeleri değiştirmez', () => {
  const a = Array.from({ length: 300 }, (_, i) => 100 + 10 * Math.sin(i / 7) + i * 0.1);
  const b = [...a.slice(0, 250), ...a.slice(250).map((x) => x * 3)];
  for (const f of [(v) => smaSeries(v, 50), (v) => rsiSeries(v), (v) => rollingMaxSeries(v, 52), (v) => volatilitySeries(v, 20, 252)]) {
    const sa = f(a);
    const sb = f(b);
    for (let i = 0; i < 250; i++) assert.equal(sa[i], sb[i], `indeks ${i}`);
  }
});
