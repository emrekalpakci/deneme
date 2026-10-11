// Formdan işlem kaydı üretimi ve servis çalışanı dosya listesi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildTxFromForm } from '../../site/js/ui/views/portfolio.js';

const base = { type: 'buy', asset: 'gram-altin', mode: 'unit', qty: '', price: '', total: '', usd: '', fx: '', date: '2026-10-09', fee: '0', note: '' };

test('birim fiyatla giriş: Türkçe yazım, kuruş yuvarlama', () => {
  const { tx, errors } = buildTxFromForm({ ...base, qty: '2,5', price: '6.646,19', fee: '25' });
  assert.deepEqual(errors, []);
  assert.equal(tx.qty, '2.5');
  assert.equal(tx.amountTry, '16615.48'); // 16615.475 → yarım yukarı
  assert.equal(tx.feeTry, '25.00');
});

test('toplam tutarla giriş', () => {
  const { tx } = buildTxFromForm({ ...base, asset: 'btc', qty: '0,0015', mode: 'total', total: '6.150' });
  assert.equal(tx.qty, '0.0015');
  assert.equal(tx.amountTry, '6150.00');
});

test('USD ile giriş: kur saklanır', () => {
  const { tx } = buildTxFromForm({ ...base, asset: 'eth', qty: '0,5', mode: 'usd', usd: '2.498,05', fx: '49,2706' });
  assert.equal(tx.amountTry, '61540.21'); // 0.5 × 2498.05 × 49.2706 = 61540.2111...
  assert.equal(tx.priceUsd, '2498.05');
  assert.equal(tx.fxRate, '49.2706');
});

test('eksik ya da hatalı alanlar açıkça bildirilir', () => {
  assert.ok(buildTxFromForm({ ...base, qty: '', price: '100' }).errors[0].startsWith('Miktar'));
  assert.ok(buildTxFromForm({ ...base, qty: '1', price: 'abc' }).errors[0].startsWith('Birim fiyat'));
  assert.ok(buildTxFromForm({ ...base, qty: '1', mode: 'usd', usd: '10', fx: '' }).errors[0].startsWith('Dolar/TL'));
  assert.ok(buildTxFromForm({ ...base, qty: '1', price: '1', fee: '-3' }).errors[0].startsWith('Komisyon'));
});

test('servis çalışanının önbelleğe aldığı her dosya gerçekten var', () => {
  const sw = readFileSync(new URL('../../site/sw.js', import.meta.url), 'utf8');
  const files = [...sw.matchAll(/'((?:js|css|icons)\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(files.length > 10);
  for (const f of files) assert.ok(existsSync(new URL(`../../site/${f}`, import.meta.url)), `eksik: ${f}`);
});
