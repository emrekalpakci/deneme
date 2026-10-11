// Haber ayrıştırma ve puanlama. Örnek akışlar gerçek yapıyı taklit eden uydurma test verisidir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, cleanText, safeLink, tagAssets, scoreHeadline, buildNews, newsScores, decodeXmlBytes, lowerTr } from '../../site/js/core/news.js';

const fx = (n) => readFileSync(new URL(`../fixtures/news/${n}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-11T08:00:00Z');

test('RSS: CDATA, karakter kodları, tarih biçimleri', () => {
  const items = parseFeed(fx('rss-ornek.xml'));
  assert.equal(items[0].title, 'Gram altın rekor kırdı: ons 4.200 doları aştı');
  assert.equal(items[0].publishedAt, '2026-10-11T07:25:00.000Z');
  assert.equal(items[1].title, "Bitcoin'de satış baskısı & sert düşüş");
  assert.equal(items[1].link, 'https://ornek.com.tr/kripto/btc?a=1&b=2');
  assert.equal(items[2].publishedAt, '2026-10-11T06:00:00.000Z');
});

test('güvenlik: betik ve HTML temizlenir, javascript: ve http bağlantıları atılır', () => {
  const items = parseFeed(fx('rss-ornek.xml'));
  const silver = items.find((i) => i.title.startsWith('Gümüş'));
  assert.equal(silver.title, 'Gümüş fiyatları yükseldi');
  assert.equal(silver.link, 'https://ornek.com.tr/gumus-yukseldi', 'javascript: yerine guid kullanılır');
  assert.ok(!items.some((i) => i.link.startsWith('http:')), 'güvensiz http bağlantısı alınmaz');
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,x'), null);
  assert.equal(cleanText('a<script>kötü()</script>b'), 'a b');
  assert.equal(cleanText('&lt;img src=x onerror=alert(1)&gt;Başlık'), 'Başlık');
});

test('Atom akışı', () => {
  const items = parseFeed(fx('atom-ornek.xml'));
  assert.equal(items.length, 2);
  assert.equal(items[0].link, 'https://ornek.com/eth-rally');
  assert.equal(items[1].publishedAt, '2026-10-10T20:00:00.000Z');
});

test('Türkçe büyük/küçük harf: İ → i, I → ı', () => {
  assert.equal(lowerTr('İSTANBUL ALTIN'), 'istanbul altın');
  assert.deepEqual(tagAssets('ALTIN FİYATLARI YÜKSELDİ'), ['gram-altin']);
  assert.equal(scoreHeadline('ALTIN FİYATLARI YÜKSELDİ').s, 1);
});

test('windows-1254 kodlu akış doğru okunur', () => {
  const xml = '<?xml version="1.0" encoding="windows-1254"?><rss><channel><item><title>Gümüş</title></item></channel></rss>';
  const bytes = Uint8Array.from([...xml].map((ch) => ({ 'ü': 0xfc, 'ş': 0xfe }[ch] ?? ch.charCodeAt(0))));
  assert.match(decodeXmlBytes(bytes), /<title>Gümüş<\/title>/);
});

test('varlık etiketleme: mecaz ve "altında" tuzakları', () => {
  assert.deepEqual(tagAssets('Gram altın rekor kırdı'), ['gram-altin']);
  assert.deepEqual(tagAssets('Altın 4.000 doların altında'), ['gram-altin']);
  assert.deepEqual(tagAssets('Dolar 49 liranın altında kaldı'), ['dolar'], '"altında" altın sayılmaz; haber Dolar haberidir');
  assert.deepEqual(tagAssets('Şehrin altın çocuğu yarışmaya gidiyor'), [], 'ekonomi bağlamı yoksa altın sayılmaz');
  assert.deepEqual(tagAssets('Gümüş madalya kazandı'), []);
  assert.deepEqual(tagAssets('Gold steadies near $4,200'), ['gram-altin']);
  assert.deepEqual(tagAssets("Bitcoin'de satış baskısı"), ['btc']);
  assert.deepEqual(tagAssets('Kripto piyasasında sert düşüş'), ['btc', 'eth']);
  assert.deepEqual(tagAssets('New methods for ethics'), [], '"eth" kelime içinde aranmaz');
});

test('duygu puanı: olumlu, olumsuz, nötr ve eşleşen kelimeler', () => {
  assert.deepEqual(scoreHeadline('Gümüş fiyatları yükseldi'), { s: 1, pos: ['yükseldi'], neg: [] });
  assert.equal(scoreHeadline('Bitcoin sert düştü').s, -1);
  assert.equal(scoreHeadline('Altın yükseldi, gümüş geriledi').s, 0, 'eşitlikte nötr');
  assert.equal(scoreHeadline('Altın fiyatları ne kadar?').s, 0);
  assert.equal(scoreHeadline('Crypto market slides').s, -1);
});

test('haber dosyası: 72 saat, tekrar ayıklama, tarihsiz haber yok', () => {
  const rss = parseFeed(fx('rss-ornek.xml'));
  const atom = parseFeed(fx('atom-ornek.xml'));
  const dup = [{ ...rss[0], link: 'https://baska.com/ayni-haber' }];
  const old = [{ title: 'Eski altın fiyat haberi', link: 'https://ornek.com/eski', publishedAt: '2026-10-01T00:00:00Z' }];
  const news = buildNews(
    [
      { id: 'a', name: 'A', ok: true, items: rss },
      { id: 'b', name: 'B', ok: true, items: [...atom, ...dup, ...old] },
      { id: 'c', name: 'C', ok: false, why: 'HTTP 503', items: [] },
    ],
    NOW,
  );
  const titles = news.items.map((i) => i.title);
  assert.ok(!titles.includes('Tarihsiz haber'));
  assert.ok(!titles.includes('Eski altın fiyat haberi'));
  assert.equal(titles.filter((t) => t.startsWith('Gram altın rekor')).length, 1);
  assert.deepEqual(news.feeds.find((f) => f.id === 'c'), { id: 'c', name: 'C', ok: false, why: 'HTTP 503', count: 0 });
  assert.ok(news.items.every((i, k) => k === 0 || news.items[k - 1].publishedAt >= i.publishedAt), 'yeniden eskiye');
});

test('varlık haber puanı: en az 3 haber, yeni haber daha ağır', () => {
  const mk = (h, s) => ({ assets: ['btc'], sentiment: s, publishedAt: new Date(NOW - h * 3600000).toISOString() });
  assert.deepEqual(newsScores([mk(1, 1), mk(2, 1)], NOW).btc, { score: null, n: 2 });
  const sc = newsScores([mk(0, 1), mk(48, -1), mk(48, -1)], NOW).btc;
  // ağırlıklar 1, 0.25, 0.25 → (1 − 0.5) / 1.5 = 0.333
  assert.equal(sc.score, 33);
  assert.equal(sc.n, 3);
});
