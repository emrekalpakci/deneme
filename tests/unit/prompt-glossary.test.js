import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudePrompt, INSTRUCTION } from '../../site/js/core/prompt.js';
import { GLOSSARY } from '../../site/js/core/glossary.js';
import { buildMarket } from '../../site/js/core/market.js';
import { okDatum, unavailable } from '../../site/js/core/datum.js';
import { valuePortfolio } from '../../site/js/core/portfolio.js';

const NOW = Date.parse('2026-10-13T11:00:00Z');
const t = new Date(NOW - 60000).toISOString();
const history = { XAUUSD: [['2026-10-12', 4150]], XAGUSD: [['2026-10-12', 60]], USDTRY: [['2026-10-12', 49.2]], BTCUSD: [['2026-10-12', 80000]], ETHUSD: [['2026-10-12', 2400]] };
const live = { XAU: okDatum(4195.6, t, 'gold-api.com'), XAG: okDatum(60.95, t, 'gold-api.com'), BTC: okDatum(82900, t, 'Coinbase'), ETH: unavailable('tüm kaynaklar', 'HTTP 503'), USDTRY: okDatum(49.27, t, 'Swissquote') };
const market = buildMarket({ now: NOW, live, history });

test('talimat ilk satırda; her fiyatın saati ve kaynağı var', () => {
  const text = buildClaudePrompt({ market, now: NOW });
  assert.equal(text.split('\n')[0], INSTRUCTION);
  assert.equal(INSTRUCTION, 'Bu verilere göre portföyümü sade bir dille değerlendir, riskleri belirt.');
  const priceLines = text.split('\n').filter((l) => /^- (Gram|Bitcoin|Dolar)/.test(l) && l.includes('$'));
  assert.ok(priceLines.length >= 3);
  for (const l of priceLines) assert.match(l, /\d{1,2} \S+ 2026 \d{2}:\d{2}/, `saat yok: ${l}`);
  assert.match(text, /gold-api\.com/);
});

test('alınamayan fiyat "alınamadı" yazılır, 0 yazılmaz', () => {
  const text = buildClaudePrompt({ market, now: NOW });
  const eth = text.split('\n').find((l) => l.startsWith('- Ethereum:'));
  assert.match(eth, /alınamadı/);
  assert.doesNotMatch(eth, /0,00 TL/);
});

test('portföy, sinyal ve haberler eklenir; boş portföy ve eksik haber açıkça yazılır', () => {
  const tx = [{ id: 'a', type: 'buy', asset: 'gram-altin', date: '2026-03-02', qty: '5', amountTry: '28500', feeTry: '0' }];
  const prices = { 'gram-altin': market.assets['gram-altin'].try };
  const v = valuePortfolio(tx, prices);
  const news = { items: [{ title: 'Gold rises', source: 'FXStreet', publishedAt: t, sentiment: 1, assets: ['gram-altin'] }] };
  const text = buildClaudePrompt({
    market,
    valuation: v,
    targets: () => ({ tp: '15', sl: '8' }),
    signals: { 'gram-altin': [{ title: 'Kâr hedefine ulaşıldı' }] },
    news,
    now: NOW,
  });
  assert.match(text, /Gram Altın: 5 g, ortalama maliyet 5\.700,00 TL\/g/);
  assert.match(text, /sinyal: Kâr hedefine ulaşıldı/);
  assert.match(text, /\[olumlu\] Gold rises \(FXStreet/);
  const empty = buildClaudePrompt({ market, now: NOW, news: null });
  assert.match(empty, /Portföyüm boş/);
  assert.match(empty, /Haber başlıkları yüklenemedi/);
});

test('metinde token ya da gizli bilgi biçimi yok', () => {
  const text = buildClaudePrompt({ market, now: NOW });
  assert.doesNotMatch(text, /ghp_|github_pat_|token|bot\d+:/i);
});

test('sözlük: en az 25 terim, hepsi açıklamalı ve benzersiz', () => {
  assert.ok(GLOSSARY.length >= 25);
  const names = new Set(GLOSSARY.map((g) => g.term));
  assert.equal(names.size, GLOSSARY.length);
  for (const g of GLOSSARY) assert.ok(g.text.length > 30, g.term);
});

test('sözlük araması Türkçe harf farklarını önemsemez', async () => {
  const { fold } = await import('../../site/js/ui/views/glossary.js');
  assert.equal(fold('RSI'), fold('rsi'));
  assert.equal(fold('Oynaklık'), fold('oynaklik'));
  assert.ok(GLOSSARY.filter((g) => fold(g.term).includes(fold('rsi'))).length >= 1);
});
