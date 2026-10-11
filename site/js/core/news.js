// Haberler: RSS/Atom ayrıştırma, varlık etiketleme ve anahtar kelimeyle olumlu/olumsuz/nötr puan.
// Sadece başlık, kaynak, saat ve bağlantı kullanılır. Puanlama basittir ve yanılabilir
// (ör. olumsuzluk ekini, iğneli dili anlamaz); bu, ekranda açıkça yazılır.

export const NEWS_SCHEMA = 1;
const WINDOW_HOURS = 72;
const HALF_LIFE_HOURS = 24;
const MIN_ITEMS = 3;

// --- XML ayrıştırma ------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Etiket içeriği: CDATA açılır, HTML etiketleri ve fazla boşluk temizlenir, düz metin döner. */
export function cleanText(raw) {
  if (!raw) return '';
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = decodeEntities(s); // bazı akışlar HTML'i çift kodlar: önce çöz, sonra etiketleri at
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : null;
}

/** Sadece https bağlantıları kabul edilir (javascript:, data: vb. atılır). */
export function safeLink(raw) {
  const s = cleanText(raw || '');
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseDate(raw) {
  const s = cleanText(raw || '');
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** RSS 2.0 ve Atom akışlarını ayrıştırır: [{ title, link, publishedAt }] */
export function parseFeed(xml) {
  if (typeof xml !== 'string') return [];
  const out = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const it of items) {
    out.push({
      title: cleanText(tag(it, 'title')).slice(0, 300),
      link: safeLink(tag(it, 'link')) || safeLink(tag(it, 'guid')),
      publishedAt: parseDate(tag(it, 'pubDate') || tag(it, 'dc:date') || tag(it, 'published')),
    });
  }
  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const e of entries) {
    const href = e.match(/<link[^>]*?href=["']([^"']+)["'][^>]*>/i);
    out.push({
      title: cleanText(tag(e, 'title')).slice(0, 300),
      link: safeLink(href ? href[1] : tag(e, 'link')),
      publishedAt: parseDate(tag(e, 'published') || tag(e, 'updated')),
    });
  }
  return out.filter((x) => x.title && x.link);
}

// --- Varlık etiketleme -------------------------------------------------------------------

const L = 'a-zçğıöşü0-9';

/** Başlığı Türkçe kurallarla küçük harfe çevirir ("İ" → "i", "I" → "ı"). */
export function lowerTr(s) {
  return s.toLocaleLowerCase('tr-TR');
}

const tokens = (t) => lowerTr(t).split(/[^a-zçğıöşüâîû0-9]+/).filter(Boolean);
// "altında / altına" çoğunlukla "seviyenin altında" anlamındadır, altın (gold) değil.
const BELOW = new Set(['altında', 'altına', 'altından', 'altındaki', 'altındadır', 'altındaydı', 'altinda', 'altina']);
const starts = (w, ...ps) => ps.some((p) => w.startsWith(p));

const ASSET_RULES = {
  'gram-altin': (w) => (starts(w, 'altın', 'altin') && !BELOW.has(w)) || ['gold', 'ons', 'xau'].includes(w) || starts(w, 'külçe'),
  'gram-gumus': (w) => starts(w, 'gümüş', 'gumus') || ['silver', 'xag'].includes(w),
  btc: (w) => starts(w, 'bitcoin') || w === 'btc',
  eth: (w) => starts(w, 'ethereum') || ['eth', 'ether'].includes(w),
};
const cryptoGeneral = (w) => starts(w, 'kripto') || ['crypto', 'cryptocurrency', 'cryptocurrencies'].includes(w);

// Türkçe "altın/gümüş" mecaz da olabilir ("altın çocuk", "gümüş madalya"); bu kelimelerle eşleşen
// başlıkta ayrıca bir piyasa/ekonomi kelimesi aranır.
const FINANCE = ['fiyat', 'gram', 'ons', 'çeyrek', 'piyasa', 'yatırım', 'dolar', 'borsa', 'kur', 'rekor', 'yüksel', 'düş', 'geril',
  'değer', 'merkez', 'fed', 'emtia', 'kıymetli', 'satış', 'alış', 'faiz', 'enflasyon', 'tl', 'lira', 'kilogram', 'ithalat', 'ihracat', 'rezerv'];
const needsContext = { 'gram-altin': (w) => starts(w, 'altın', 'altin'), 'gram-gumus': (w) => starts(w, 'gümüş', 'gumus') };

export function tagAssets(title) {
  const ws = tokens(title);
  const hasFinance = ws.some((w) => FINANCE.some((f) => w.startsWith(f))) || /[%$₺]/.test(title);
  const tags = Object.keys(ASSET_RULES).filter((id) => {
    const hits = ws.filter(ASSET_RULES[id]);
    if (!hits.length) return false;
    const onlyTurkish = needsContext[id] && hits.every(needsContext[id]);
    return !onlyTurkish || hasFinance;
  });
  if (!tags.includes('btc') && !tags.includes('eth') && ws.some(cryptoGeneral)) tags.push('btc', 'eth');
  return tags;
}

// --- Duygu puanı --------------------------------------------------------------------------

const POSITIVE = [
  'yükseldi', 'yükseliş', 'yükselişte', 'yükseliyor', 'yükselerek', 'arttı', 'artış', 'rekor', 'zirve', 'tırmandı', 'tırmanış',
  'kazandı', 'kazanç', 'prim yaptı', 'değer kazandı', 'toparlandı', 'toparlanma', 'ralli', 'sıçradı', 'güçlendi', 'yukarı yönlü',
  'rise', 'rises', 'rising', 'rose', 'gain', 'gains', 'surge', 'surges', 'surged', 'soar', 'soars', 'soared', 'rally', 'rallies',
  'record high', 'all-time high', 'jump', 'jumps', 'jumped', 'climb', 'climbs', 'climbed', 'bullish', 'rebound', 'rebounds', 'recovers',
];
const NEGATIVE = [
  'düştü', 'düşüş', 'düşüşte', 'düşüyor', 'düşerek', 'geriledi', 'geriliyor', 'gerileme', 'kayıp', 'kaybetti', 'değer kaybetti',
  'çöktü', 'çöküş', 'satış baskısı', 'eridi', 'dibe', 'en düşük', 'zayıfladı', 'tepetaklak', 'sert satış', 'aşağı yönlü',
  'fall', 'falls', 'fell', 'drop', 'drops', 'dropped', 'plunge', 'plunges', 'plunged', 'slump', 'slumps', 'slide', 'slides',
  'decline', 'declines', 'declined', 'crash', 'crashes', 'losses', 'loses', 'bearish', 'sell-off', 'selloff', 'tumble', 'tumbles', 'sinks',
];
const toRe = (w) => new RegExp(`(^|[^${L}])${w.replace(/[-]/g, '\\-')}($|[^${L}])`, 'i');
const POS_RE = POSITIVE.map((w) => [w, toRe(w)]);
const NEG_RE = NEGATIVE.map((w) => [w, toRe(w)]);

/** −1 (olumsuz), 0 (nötr), +1 (olumlu) ve eşleşen kelimeler. */
export function scoreHeadline(title) {
  const t = lowerTr(title);
  const pos = POS_RE.filter(([, re]) => re.test(t)).map(([w]) => w);
  const neg = NEG_RE.filter(([, re]) => re.test(t)).map(([w]) => w);
  const s = Math.sign(pos.length - neg.length);
  return { s, pos, neg };
}

// --- Haber dosyası ---------------------------------------------------------------------------

function normTitle(t) {
  return lowerTr(t).replace(/[^a-zçğıöşü0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * feeds: [{ id, name, ok, why, items: [{title, link, publishedAt}] }]
 * Son 72 saatin haberleri; tekrarlar atılır; varlık başına zamana göre ağırlıklı puan.
 */
export function buildNews(feeds, now = Date.now()) {
  const seen = new Set();
  const items = [];
  for (const f of feeds) {
    for (const it of f.items || []) {
      if (!it.publishedAt) continue;
      const age = (now - Date.parse(it.publishedAt)) / 3600000;
      if (age > WINDOW_HOURS || age < -1) continue;
      const key = normTitle(it.title);
      if (seen.has(key) || seen.has(it.link)) continue;
      seen.add(key);
      seen.add(it.link);
      const { s, pos, neg } = scoreHeadline(it.title);
      items.push({
        id: `${f.id}:${items.length}`,
        title: it.title,
        link: it.link,
        source: f.name,
        publishedAt: it.publishedAt,
        assets: tagAssets(it.title),
        sentiment: s,
        hits: { pos, neg },
      });
    }
  }
  items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return {
    schemaVersion: NEWS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    windowHours: WINDOW_HOURS,
    feeds: feeds.map((f) => ({ id: f.id, name: f.name, ok: !!f.ok, why: f.why || null, count: (f.items || []).length })),
    items: items.slice(0, 200),
    perAsset: newsScores(items, now),
  };
}

/** Varlık başına haber puanı: 100 × Σ(ağırlık × duygu) / Σ ağırlık; ağırlık = 0,5^(saat/24). En az 3 haber. */
export function newsScores(items, now = Date.now()) {
  const out = {};
  for (const id of Object.keys(ASSET_RULES)) {
    const rel = items.filter((i) => i.assets.includes(id));
    if (rel.length < MIN_ITEMS) {
      out[id] = { score: null, n: rel.length };
      continue;
    }
    let sw = 0;
    let s = 0;
    for (const it of rel) {
      const age = Math.max(0, (now - Date.parse(it.publishedAt)) / 3600000);
      const w = 0.5 ** (age / HALF_LIFE_HOURS);
      sw += w;
      s += w * it.sentiment;
    }
    out[id] = { score: Math.round((100 * s) / sw), n: rel.length };
  }
  return out;
}

/** XML baytlarını, belgedeki ya da sunucunun bildirdiği karakter kümesiyle metne çevirir (ör. windows-1254). */
export function decodeXmlBytes(bytes, contentType = '') {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 200));
  const declared = head.match(/encoding=["']([\w-]+)["']/i)?.[1] || contentType.match(/charset=([\w-]+)/i)?.[1] || 'utf-8';
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
