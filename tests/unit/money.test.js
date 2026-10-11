import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Big,
  dec,
  decFromNumber,
  parseTrNumber,
  formatDecimal,
  formatTry,
  formatUsd,
  formatPercent,
  formatQuantity,
} from '../../site/js/core/money.js';

test('JS ondalık hatası Big ile yaşanmaz', () => {
  assert.equal(4123.4 * 12.5, 51542.49999999999); // düz JS'in hatası
  assert.equal(dec('4123.4').times('12.5').toFixed(2), '51542.50');
});

test('katı mod: JS sayısı doğrudan kabul edilmez', () => {
  assert.throws(() => dec(0.1), TypeError);
  assert.equal(decFromNumber(0.1).toString(), '0.1');
  assert.equal(decFromNumber(NaN), null);
  assert.equal(decFromNumber(Infinity), null);
});

test('Türkçe sayı ayrıştırma: tutar', () => {
  const ok = (s, v) => {
    const r = parseTrNumber(s, 'amount');
    assert.equal(r.ok, true, `${s} kabul edilmeliydi: ${r.error}`);
    assert.ok(new Big(r.value).eq(v), `${s} → ${r.value}, beklenen ${v}`);
  };
  ok('1.250,50', '1250.50');
  ok('1250,5', '1250.5');
  ok('1.250', '1250');
  ok('12.500', '12500');
  ok('1.234.567,89', '1234567.89');
  ok('1.234.567', '1234567');
  ok('1,250.50', '1250.50');
  ok('₺ 12 500', '12500');
  ok('12,5 TL', '12.5');
  ok('0.005', '0.005');
  ok('12.5', '12.5');
  ok('0', '0');
  ok(',5', '0.5');
});

test('Türkçe sayı ayrıştırma: miktar', () => {
  assert.equal(parseTrNumber('1.250', 'quantity').value, '1.25');
  assert.equal(parseTrNumber('0,005', 'quantity').value, '0.005');
  assert.equal(parseTrNumber('0,00012345', 'quantity').value, '0.00012345');
});

test('Türkçe sayı ayrıştırma: hatalı girişler reddedilir', () => {
  for (const s of ['', '   ', '1,2,3', '-5', '−5', '1e5', 'abc', '5,', '5.', '1.2.3', '12,34,5']) {
    const r = parseTrNumber(s, 'amount');
    assert.equal(r.ok, false, `"${s}" reddedilmeliydi`);
    assert.ok(r.error.length > 0);
  }
  assert.equal(parseTrNumber(undefined).ok, false);
});

test('Türkçe gösterim: binlik nokta, ondalık virgül, tam doğruluk', () => {
  assert.equal(formatDecimal('12345678901234.56', 2), '12.345.678.901.234,56');
  assert.equal(formatDecimal('1250.5', 2), '1.250,50');
  assert.equal(formatDecimal('999', 0), '999');
  assert.equal(formatDecimal('1000', 0), '1.000');
  assert.equal(formatTry('4512.374'), '4.512,37 TL');
  assert.equal(formatUsd('4212.5'), '$4.212,50');
  assert.equal(formatUsd('-12.5'), '−$12,50');
});

test('yuvarlama yarım yukarı, "-0,00" asla yok', () => {
  assert.equal(formatDecimal('2.345', 2), '2,35');
  assert.equal(formatDecimal('2.344', 2), '2,34');
  assert.equal(formatDecimal('-2.345', 2), '−2,35');
  assert.equal(formatDecimal('-0.001', 2), '0,00');
  assert.equal(formatDecimal(-0.004, 2), '0,00');
});

test('yüzde ve miktar gösterimi', () => {
  assert.equal(formatPercent('12.345'), '%12,35');
  assert.equal(formatPercent('12.345', 2, { signed: true }), '+%12,35');
  assert.equal(formatPercent('-3.1', 2, { signed: true }), '−%3,10');
  assert.equal(formatPercent('0.001', 2, { signed: true }), '%0,00');
  assert.equal(formatQuantity('25.5000', 4, 'g'), '25,5 g');
  assert.equal(formatQuantity('0.00123000', 8, 'BTC'), '0,00123 BTC');
  assert.equal(formatQuantity('3', 4, 'g'), '3 g');
});

test('gösterim JS sayısını da kabul eder ama geçersiz sayıyı reddeder', () => {
  assert.equal(formatDecimal(1234.5, 2), '1.234,50');
  assert.throws(() => formatDecimal(NaN, 2));
});
