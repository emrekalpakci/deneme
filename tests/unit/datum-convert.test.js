import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Big } from '../../site/js/core/money.js';
import {
  ST,
  okDatum,
  unavailable,
  positivePrice,
  withStaleness,
  combine,
  isUsable,
} from '../../site/js/core/datum.js';
import { gramTryFromOunce, gramUsdFromOunce, usdToTry } from '../../site/js/core/convert.js';
import { ASSETS, getAsset, GRAMS_PER_TROY_OUNCE } from '../../site/js/core/assets.js';

const T1 = '2026-10-10T12:00:00Z';
const T2 = '2026-10-10T12:30:00Z';

test('gram altın formülü: ons × kur ÷ 31,1035', () => {
  const ons = okDatum(4200, T1, 'test');
  const kur = okDatum(41.85, T2, 'test');
  const g = gramTryFromOunce(ons, kur);
  const expected = new Big('4200').times('41.85').div(GRAMS_PER_TROY_OUNCE).round(4).toNumber();
  assert.equal(g.v, expected);
  assert.equal(g.st, ST.OK);
  assert.equal(g.asOf, new Date(T1).toISOString(), 'zaman en eski parçanın zamanı olmalı');
  assert.equal(gramUsdFromOunce(ons).v, new Big('4200').div('31.1035').round(6).toNumber());
});

test('kur yoksa gram TL fiyatı da yok (uydurma yok)', () => {
  const ons = okDatum(4200, T1, 'gold-api');
  const kur = unavailable('frankfurter', 'HTTP 503');
  const g = gramTryFromOunce(ons, kur);
  assert.equal(g.st, ST.UNAVAILABLE);
  assert.equal(g.v, null);
  assert.match(g.why, /frankfurter/);
  assert.equal(isUsable(g), false);
});

test('eski veri birleşince sonuç da eski işaretlenir', () => {
  const now = new Date('2026-10-10T18:00:00Z').getTime();
  const fresh = okDatum(100, '2026-10-10T17:55:00Z', 'a');
  const old = withStaleness(okDatum(40, '2026-10-10T10:00:00Z', 'b'), 2 * 3600e3, now);
  assert.equal(old.st, ST.STALE);
  assert.equal(old.v, 40, 'eski veri saklanmaz, işaretlenir');
  const c = combine([fresh, old], (a, b) => a * b, 'hesap');
  assert.equal(c.st, ST.STALE);
  assert.equal(c.asOf, new Date('2026-10-10T10:00:00Z').toISOString());
});

test('sıfır, negatif, NaN ve zamansız değerler "yok" sayılır', () => {
  assert.equal(positivePrice(0, T1, 's').st, ST.UNAVAILABLE);
  assert.equal(positivePrice(-5, T1, 's').st, ST.UNAVAILABLE);
  assert.equal(positivePrice(NaN, T1, 's').st, ST.UNAVAILABLE);
  assert.equal(positivePrice('12', T1, 's').st, ST.UNAVAILABLE);
  assert.equal(positivePrice(12, null, 's').st, ST.UNAVAILABLE);
  assert.equal(positivePrice(12, 'saçma', 's').st, ST.UNAVAILABLE);
  assert.equal(positivePrice(12, T1, 's').st, ST.OK);
});

test('USD → TL dönüşümü', () => {
  const d = usdToTry(okDatum(65000.5, T1, 'coinbase'), okDatum(41.85, T1, 'kur'));
  assert.equal(d.v, new Big('65000.5').times('41.85').toNumber());
});

test('varlık listesi tutarlı', () => {
  const ids = new Set(ASSETS.map((a) => a.id));
  assert.equal(ids.size, ASSETS.length, 'kimlikler benzersiz olmalı');
  for (const a of ASSETS) {
    assert.ok(['metal', 'crypto', 'fx'].includes(a.kind));
    assert.ok(Number.isInteger(a.qtyDecimals));
    assert.ok(new Big(a.defaults.tp).gt('0') && new Big(a.defaults.sl).gt('0'));
  }
  assert.equal(getAsset('btc').symbol, 'BTC');
  assert.equal(getAsset('yok'), null);
});
