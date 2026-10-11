import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  merge,
  dropWeekends,
  isWeekend,
  addDays,
  valueOn,
  overlapStats,
  extendBackwards,
} from '../../site/js/core/series.js';

test('normalize: sıralar, tekilleştirir, geçersizleri atar', () => {
  const s = normalize([
    ['2026-10-02', 2],
    ['2026-10-01', 1],
    ['2026-10-02', 3],
    ['bozuk', 5],
    ['2026-10-03', 0],
    ['2026-10-04', NaN],
  ]);
  assert.deepEqual(s, [
    ['2026-10-01', 1],
    ['2026-10-02', 3],
  ]);
});

test('merge: aynı günde yeni değer kazanır', () => {
  assert.deepEqual(merge([['2026-10-01', 1]], [['2026-10-01', 2], ['2026-10-02', 3]]), [
    ['2026-10-01', 2],
    ['2026-10-02', 3],
  ]);
});

test('hafta sonu ayıklama ve gün hesabı', () => {
  assert.equal(isWeekend('2026-10-10'), true); // Cumartesi
  assert.equal(isWeekend('2026-10-11'), true); // Pazar
  assert.equal(isWeekend('2026-10-12'), false);
  assert.deepEqual(dropWeekends([['2026-10-09', 1], ['2026-10-10', 2], ['2026-10-12', 3]]), [
    ['2026-10-09', 1],
    ['2026-10-12', 3],
  ]);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('valueOn: o gün yoksa önceki gün (en fazla 5 gün)', () => {
  const s = [
    ['2026-10-08', 49.1],
    ['2026-10-09', 49.2],
  ];
  assert.equal(valueOn(s, '2026-10-09'), 49.2);
  assert.equal(valueOn(s, '2026-10-11'), 49.2, 'hafta sonu Cuma kuru kullanılır');
  assert.equal(valueOn(s, '2026-10-11', { ffill: false }), null);
  assert.equal(valueOn(s, '2026-10-20'), null, 'çok eski kur kullanılmaz');
  assert.equal(valueOn(s, '2026-10-01'), null);
});

test('overlapStats ve extendBackwards: tutarlıysa birleştirir', () => {
  const primary = [];
  const secondary = [];
  for (let i = 0; i < 40; i++) {
    const d = addDays('2026-01-01', i);
    secondary.push([d, 100 + i]);
    if (i >= 15) primary.push([d, (100 + i) * 1.002]);
  }
  const st = overlapStats(primary, secondary);
  assert.equal(st.n, 25);
  assert.ok(Math.abs(st.median - 0.002) < 1e-9);
  const ok = extendBackwards(primary, secondary);
  assert.equal(ok.report.joined, true);
  assert.equal(ok.points.length, 40);
  assert.equal(ok.points[0][0], '2026-01-01');

  const bad = extendBackwards(
    primary,
    secondary.map(([d, v]) => [d, v * 1.05]),
  );
  assert.equal(bad.report.joined, false);
  assert.equal(bad.report.reason, 'kaynaklar tutarsız');
  assert.equal(bad.points.length, 25);

  const few = extendBackwards(primary.slice(0, 5), secondary.slice(0, 20));
  assert.equal(few.report.joined, false);
  assert.equal(few.report.reason, 'ortak gün sayısı yetersiz');
});
