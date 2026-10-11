// Kaynak sırası, yedeğe geçiş ve ani sıçrama doğrulaması (ağ olmadan, sahte sağlayıcılarla).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstUsable } from '../../scripts/lib/fetchers.mjs';
import { removeSpikes } from '../../scripts/lib/history.mjs';
import { okDatum, unavailable } from '../../site/js/core/datum.js';

const T = '2026-10-13T11:00:00Z';
const prov = (id, datum) => ({ id, run: async () => ({ datum, ms: 5 }) });

test('ilk kaynak çalışıyorsa o kullanılır', async () => {
  const r = await firstUsable([prov('a', okDatum(100, T, 'A')), prov('b', okDatum(101, T, 'B'))]);
  assert.equal(r.datum.src, 'A');
  assert.equal(r.attempts.length, 1);
});

test('ilk kaynak hata verirse yedeğe geçilir; nedenler kaydedilir', async () => {
  const r = await firstUsable([prov('a', unavailable('A', 'HTTP 503')), prov('b', okDatum(101, T, 'B'))]);
  assert.equal(r.datum.src, 'B');
  assert.deepEqual(
    r.attempts.map((x) => [x.id, x.ok, x.why]),
    [
      ['a', false, 'HTTP 503'],
      ['b', true, null],
    ],
  );
});

test('hepsi başarısızsa "yok" döner, değer uydurulmaz', async () => {
  const r = await firstUsable([prov('a', unavailable('A', 'zaman aşımı')), prov('b', unavailable('B', 'HTTP 429'))]);
  assert.equal(r.datum.st, 'unavailable');
  assert.equal(r.datum.v, null);
  assert.match(r.datum.why, /a: zaman aşımı; b: HTTP 429/);
});

test('ani sıçrama ikinci kaynakla doğrulanırsa kabul edilir', async () => {
  const accept = (d) => Math.abs(d.v / 100 - 1) <= 0.15;
  const r = await firstUsable([prov('a', okDatum(130, T, 'A')), prov('b', okDatum(129, T, 'B'))], { accept });
  assert.equal(r.datum.v, 130);
  assert.equal(r.confirmedBy, 'b');
});

test('doğrulanamayan ani sıçrama reddedilir', async () => {
  const accept = (d) => Math.abs(d.v / 100 - 1) <= 0.15;
  const r = await firstUsable([prov('a', okDatum(130, T, 'A')), prov('b', okDatum(101, T, 'B'))], { accept });
  assert.equal(r.datum.st, 'unavailable');
  assert.match(r.datum.why, /doğrulanamadı/);
  const single = await firstUsable([prov('a', okDatum(130, T, 'A'))], { accept });
  assert.equal(single.datum.st, 'unavailable', 'tek kaynakla sıçrama kabul edilmez');
});

test('geçmişte tek günlük hatalı sıçramalar ayıklanır, gerçek kırılımlar kalır', () => {
  const pts = [
    ['2026-01-01', 100],
    ['2026-01-02', 101],
    ['2026-01-03', 300], // hatalı tek gün
    ['2026-01-04', 102],
    ['2026-01-05', 140], // gerçek ve kalıcı yükseliş
    ['2026-01-06', 141],
  ];
  const out = removeSpikes(pts, 0.15);
  assert.deepEqual(
    out.map((p) => p[0]),
    ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06'],
  );
});
