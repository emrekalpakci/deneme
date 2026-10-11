import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Big } from '../../site/js/core/money.js';
import {
  computePositions,
  valuePortfolio,
  validateTx,
  validatePortfolioFile,
  targetLevels,
  targetsFor,
  emptyPortfolio,
  unitPrice,
} from '../../site/js/core/portfolio.js';
import { okDatum, unavailable } from '../../site/js/core/datum.js';

let seq = 0;
const tx = (type, asset, date, qty, amountTry, feeTry = '0', extra = {}) => ({
  id: `t${++seq}`,
  type,
  asset,
  date,
  qty,
  amountTry,
  feeTry,
  createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
  ...extra,
});
const T = '2026-10-11T08:00:00Z';
const price = (v) => okDatum(v, T, 'test');

test('komisyon ortalama maliyete eklenir: 10 g × 4.000 + 20 TL → 4.002 TL/g', () => {
  const { positions } = computePositions([tx('buy', 'gram-altin', '2026-01-05', '10', '40000', '20')]);
  const p = positions['gram-altin'];
  assert.equal(p.qty.toString(), '10');
  assert.equal(p.cost.toString(), '40020');
  assert.equal(p.avgCost.toString(), '4002');
});

test('birden çok alımda ağırlıklı ortalama', () => {
  const { positions } = computePositions([
    tx('buy', 'gram-altin', '2026-01-05', '10', '40000', '0'),
    tx('buy', 'gram-altin', '2026-02-05', '5', '25000', '15'),
  ]);
  const p = positions['gram-altin'];
  assert.equal(p.qty.toString(), '15');
  assert.equal(p.cost.toString(), '65015');
  assert.equal(p.avgCost.round(4).toString(), '4334.3333');
});

test('al-sat-al: satış ortalama maliyeti değiştirmez, gerçekleşen kâr doğru', () => {
  const txs = [
    tx('buy', 'btc', '2026-01-01', '0.02', '60000', '60'), // maliyet 60.060 → 3.003.000 TL/BTC
    tx('sell', 'btc', '2026-03-01', '0.005', '20000', '20'), // satılan maliyet 15.015; net 19.980
    tx('buy', 'btc', '2026-04-01', '0.01', '35000', '35'),
  ];
  const { positions, errors } = computePositions(txs);
  assert.deepEqual(errors, []);
  const p = positions.btc;
  assert.equal(p.realized.toString(), '4965'); // 19.980 − 15.015
  assert.equal(p.qty.toString(), '0.025');
  assert.equal(p.cost.toString(), '80080'); // 60.060 − 15.015 + 35.035
  assert.equal(p.avgCost.toString(), '3203200');
});

test('hepsi satılınca maliyet sıfırlanır; sonraki alım temiz başlar', () => {
  const { positions } = computePositions([
    tx('buy', 'eth', '2026-01-01', '1', '100000', '0'),
    tx('sell', 'eth', '2026-02-01', '1', '90000', '0'),
    tx('buy', 'eth', '2026-03-01', '2', '240000', '0'),
  ]);
  const p = positions.eth;
  assert.equal(p.realized.toString(), '-10000');
  assert.equal(p.avgCost.toString(), '120000');
});

test('fazla satış reddedilir (tarih sırasına göre)', () => {
  const buy = tx('buy', 'eth', '2026-03-01', '1', '100000');
  const earlySell = tx('sell', 'eth', '2026-02-01', '0.5', '50000');
  assert.deepEqual(validateTx(earlySell, [buy], '2026-10-11'), ['Bu tarihte elindekinden fazla satış yapılamaz.']);
  const tooMuch = tx('sell', 'eth', '2026-04-01', '1.5', '150000');
  assert.equal(validateTx(tooMuch, [buy], '2026-10-11').length, 1);
  const ok = tx('sell', 'eth', '2026-04-01', '0.4', '40000', '10');
  assert.deepEqual(validateTx(ok, [buy], '2026-10-11'), []);
  const { errors } = computePositions([buy, tooMuch]);
  assert.equal(errors.length, 1);
});

test('8 haneli kripto miktarları kayıpsız', () => {
  const { positions } = computePositions([
    tx('buy', 'btc', '2026-01-01', '0.00012345', '500.12'),
    tx('buy', 'btc', '2026-01-02', '0.00000001', '0.04'),
  ]);
  assert.equal(positions.btc.qty.toString(), '0.00012346');
  assert.equal(positions.btc.cost.toString(), '500.16');
});

test('güncel değer ve kâr/zarar (TL ve %)', () => {
  const v = valuePortfolio([tx('buy', 'gram-altin', '2026-01-05', '10', '40000', '20')], { 'gram-altin': price(4602.3) });
  const r = v.rows[0];
  assert.equal(r.value.toString(), '46023');
  assert.equal(r.unrealized.toString(), '6003');
  assert.equal(r.pct.round(4).toFixed(4), '15.0000');
  assert.equal(v.totals.value.toString(), '46023');
  assert.equal(v.totals.partial, false);
});

test('fiyatı olmayan varlık 0 sayılmaz; toplam "kısmi" olur', () => {
  const v = valuePortfolio(
    [tx('buy', 'gram-altin', '2026-01-05', '10', '40000'), tx('buy', 'eth', '2026-01-05', '1', '100000')],
    { 'gram-altin': price(4500), eth: unavailable('Coinbase', 'HTTP 503') },
  );
  const eth = v.rows.find((r) => r.asset === 'eth');
  assert.equal(eth.value, null);
  assert.equal(eth.unrealized, null);
  assert.equal(v.totals.partial, true);
  assert.equal(v.totals.value, null);
  assert.equal(v.totals.valueKnown.toString(), '45000');
  assert.equal(v.totals.unrealizedKnown.toString(), '5000');
});

test('silinen işlemler hesaba katılmaz', () => {
  const { positions } = computePositions([
    tx('buy', 'gram-gumus', '2026-01-05', '100', '9000'),
    tx('buy', 'gram-gumus', '2026-01-06', '100', '9000', '0', { deleted: true }),
  ]);
  assert.equal(positions['gram-gumus'].qty.toString(), '100');
});

test('rastgele defter tutarlılığı: alınan + değer − ödenen = gerçekleşen + gerçekleşmemiş', () => {
  let rnd = 42;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let round = 0; round < 50; round++) {
    const txs = [];
    let held = new Big('0');
    for (let i = 0; i < 20; i++) {
      const date = `2026-0${1 + Math.floor(i / 4)}-1${i % 4}`;
      const qty = new Big(String(Math.floor(r() * 1e6) + 1)).div('1000000');
      const amount = qty.times(String(Math.floor(r() * 5e6) + 1000)).round(2);
      const fee = new Big(String(Math.floor(r() * 5000))).div('100');
      if (r() < 0.35 && held.gt(qty)) {
        txs.push(tx('sell', 'btc', date, qty.toString(), amount.plus(fee).toString(), fee.toString()));
        held = held.minus(qty);
      } else {
        txs.push(tx('buy', 'btc', date, qty.toString(), amount.toString(), fee.toString()));
        held = held.plus(qty);
      }
    }
    const v = valuePortfolio(txs, { btc: price(3000000.5) });
    const p = v.rows[0];
    const paid = p.bought;
    const received = p.sold;
    const left = received.plus(p.value || new Big('0')).minus(paid);
    const right = p.realized.plus(p.unrealized || new Big('0'));
    assert.ok(left.minus(right).abs().lt('0.000001'), `tur ${round}: ${left} ≠ ${right}`);
  }
});

test('kâr hedefi ve zarar sınırı seviyeleri', () => {
  const l = targetLevels(new Big('4002'), '15', '8');
  assert.equal(l.takeProfit.toString(), '4602.3');
  assert.equal(l.stopLoss.toString(), '3681.84');
  const p = emptyPortfolio();
  assert.deepEqual(targetsFor(p, 'btc'), { tp: '30', sl: '15' });
  p.settings.targets.btc = { tp: '50', sl: '10' };
  assert.deepEqual(targetsFor(p, 'btc'), { tp: '50', sl: '10' });
});

test('işlem doğrulama mesajları', () => {
  const base = { id: 'x', type: 'buy', asset: 'btc', date: '2026-10-01', qty: '0.1', amountTry: '400000', feeTry: '0' };
  assert.deepEqual(validateTx(base, [], '2026-10-11'), []);
  assert.ok(validateTx({ ...base, date: '2026-10-12' }, [], '2026-10-11').includes('İleri bir tarih girilemez.'));
  assert.ok(validateTx({ ...base, qty: '0' }, [], '2026-10-11').includes('Miktar sıfırdan büyük olmalı.'));
  assert.ok(validateTx({ ...base, amountTry: '-5' }, [], '2026-10-11').includes('Tutar geçersiz.'));
  assert.ok(validateTx({ ...base, asset: 'doge' }, [], '2026-10-11').includes('Varlık seçin.'));
  assert.ok(validateTx({ ...base, feeTry: 'abc' }, [], '2026-10-11').includes('Komisyon geçersiz.'));
  assert.equal(unitPrice({ qty: '2.5', amountTry: '16500' }).toString(), '6600');
});

test('yedek dosyası doğrulama', () => {
  assert.deepEqual(validatePortfolioFile({ schemaVersion: 1, tx: [] }), []);
  assert.equal(validatePortfolioFile({ schemaVersion: 2, tx: [] }).length, 1);
  assert.equal(validatePortfolioFile(null).length, 1);
  const bad = validatePortfolioFile({ schemaVersion: 1, tx: [{ id: 'a', type: 'sell', asset: 'btc', date: '2026-01-01', qty: '1', amountTry: '10' }] });
  assert.ok(bad.some((e) => e.startsWith('Fazla satış')));
});
