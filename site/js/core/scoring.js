// Kural tabanlı analiz puanı. Sabitler bilerek kilitlidir: değiştirmeden önce SCORING_VERSION'ı
// artırın ve docs/KARARLAR.md'ye yazın. Ağırlıklar geçmiş veriye göre ayarlanmaz (aşırı uyum olmasın).

import { smaSeries, rsiSeries, rollingMaxSeries, volatilitySeries, percentRankSeries, changeSeries } from './indicators.js';

export const SCORING_VERSION = 1;

export const FACTORS = Object.freeze([
  { id: 'trend', name: 'Trend (50/200 günlük ortalama)', weight: 0.3 },
  { id: 'rsi', name: 'RSI (14 gün)', weight: 0.2 },
  { id: 'peak', name: 'Zirveden uzaklık (1 yıl)', weight: 0.15 },
  { id: 'vol', name: 'Oynaklık', weight: 0.15 },
  { id: 'fx', name: 'Dolar/TL trendi (3 ay)', weight: 0.1 },
  { id: 'news', name: 'Haber puanı (72 saat)', weight: 0.1 },
]);

/** Geçmiş testte kullanılabilen faktörler (haber ve kur geçmişte test edilmez). */
export const TESTED = Object.freeze(['trend', 'rsi', 'peak', 'vol']);

export const RULES = Object.freeze({
  buyMin: 25, // toplam puan ≥ 25 ve trend ≥ 0 → "Alım için uygun"
  expensiveMax: -60, // (RSI puanı + zirve puanı) / 2 ≤ −60 → "Pahalı görünüyor"
  minWeight: 0.7, // ağırlığın %70'inden azı varsa → "Veri yetersiz"
  fxNeutral: 0.03, // 3 ayda %3 (ayda ~%1) kur artışı nötr kabul edilir
});

export const LABELS = Object.freeze({
  buy: 'Alım için uygun',
  wait: 'Bekle',
  expensive: 'Pahalı görünüyor',
  none: 'Veri yetersiz',
});

const PERIODS = { metal: 252, crypto: 365 };
const clamp = (x, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, x));

/** Bir fiyat serisi için tüm gösterge serileri (nedensel). */
export function technicalSeries(values, kind) {
  const ppy = PERIODS[kind] || 252;
  const vol20 = volatilitySeries(values, 20, ppy);
  return {
    ppy,
    ma50: smaSeries(values, 50),
    ma200: smaSeries(values, 200),
    rsi: rsiSeries(values, 14),
    high: rollingMaxSeries(values, ppy),
    volYear: volatilitySeries(values, ppy, ppy),
    vol20,
    volRank: percentRankSeries(vol20, 3 * ppy, 126),
  };
}

/** i. gündeki teknik faktör puanları (−100…+100) ve ham değerler. */
export function technicalFactorsAt(values, t, i) {
  const p = values[i];
  const out = {};
  const ma50 = t.ma50[i];
  const ma200 = t.ma200[i];
  out.trend =
    ma200 === null || ma50 === null
      ? { score: null }
      : { score: (p > ma200 ? 50 : -50) + (ma50 > ma200 ? 50 : -50), raw: { price: p, ma50, ma200 } };
  const rsi = t.rsi[i];
  out.rsi = rsi === null ? { score: null } : { score: clamp(5 * (50 - rsi)), raw: { rsi } };
  const high = t.high[i];
  const vy = t.volYear[i];
  if (high === null || !vy) out.peak = { score: null };
  else {
    const dd = p / high - 1; // 0 ya da negatif
    out.peak = { score: clamp(-50 - (150 * dd) / vy), raw: { drawdown: dd, high, volYear: vy } };
  }
  const rank = t.volRank[i];
  out.vol = rank === null ? { score: null } : { score: clamp(100 - 200 * rank), raw: { rank, vol20: t.vol20[i] } };
  return out;
}

/** Dolar/TL 3 aylık (63 işlem günü) değişimine göre kur faktörü. */
export function fxFactor(fxValues) {
  const c = changeSeries(fxValues, 63).at(-1);
  if (c === null || c === undefined || !Number.isFinite(c)) return { score: null };
  return { score: clamp(1000 * (c - RULES.fxNeutral)), raw: { change3m: c } };
}

/**
 * Faktörlerden toplam puan ve etiket. only: sadece bu faktörleri kullan (geçmiş test için).
 * stale: fiyat eskiyse etiket "Veri yetersiz" olur.
 */
export function scoreFactors(factors, { only = null, stale = false } = {}) {
  const list = FACTORS.filter((f) => !only || only.includes(f.id));
  const totalW = list.reduce((s, f) => s + f.weight, 0);
  const avail = list.filter((f) => factors[f.id] && factors[f.id].score !== null && factors[f.id].score !== undefined);
  const availW = avail.reduce((s, f) => s + f.weight, 0);
  const total = availW > 0 ? avail.reduce((s, f) => s + f.weight * factors[f.id].score, 0) / availW : null;
  const rows = list.map((f) => {
    const sc = factors[f.id]?.score ?? null;
    return { id: f.id, name: f.name, weight: f.weight / totalW, score: sc, contribution: sc === null ? null : (f.weight * sc) / availW };
  });
  const T = factors.trend?.score ?? null;
  const R = factors.rsi?.score ?? null;
  const D = factors.peak?.score ?? null;
  const valuation = R === null ? null : D === null ? R : (R + D) / 2;
  let label;
  if (stale || availW / totalW < RULES.minWeight || T === null || R === null) label = 'none';
  else if (valuation <= RULES.expensiveMax) label = 'expensive';
  else if (total >= RULES.buyMin && T >= 0) label = 'buy';
  else label = 'wait';
  return { total, availShare: availW / totalW, rows, label, valuation };
}

/**
 * Güven seviyesi. Varsayılan "orta"; koşullara göre "düşük" ya da (hepsi sağlanırsa) "yüksek".
 * bt: bu etiketin geçmiş test özeti ({ nInd, edgePp, ciLow, baseline }).
 */
export function confidence({ label, total, valuation, availShare, stale, factors, kind, bt }) {
  if (label === 'none') return null;
  const low = [];
  if (availShare < 0.9) low.push('bazı göstergeler için veri yok');
  if (stale) low.push('fiyat güncel değil');
  if (label === 'buy' && total < RULES.buyMin + 10) low.push('puan eşiğe çok yakın');
  if (label === 'wait' && (total >= RULES.buyMin - 10 || valuation <= RULES.expensiveMax + 10)) low.push('puan eşiğe çok yakın');
  if (label === 'expensive' && valuation > RULES.expensiveMax - 10) low.push('puan eşiğe çok yakın');
  const rank = factors.vol?.raw?.rank;
  if (rank !== undefined && rank >= 0.8) low.push('fiyat hareketleri normalden çok sert');
  if (label !== 'wait' && (!bt || bt.nInd < 10 || !(bt.edgePp > 0))) low.push('geçmiş testte bu sinyalin kanıtı zayıf');
  if (low.length) return { level: 'low', text: 'Düşük', why: low };

  if (label !== 'wait' && kind !== 'crypto' && rank !== undefined && rank < 0.6 && bt && bt.edgePp >= 10 && bt.ciLow > bt.baseline) {
    const dir = label === 'buy' ? 1 : -1;
    const avail = FACTORS.filter((f) => factors[f.id]?.score !== null && factors[f.id]?.score !== undefined);
    const w = avail.reduce((s, f) => s + f.weight, 0);
    const agree = avail.filter((f) => Math.sign(factors[f.id].score) === dir).reduce((s, f) => s + f.weight, 0) / w;
    if (agree >= 0.8) return { level: 'high', text: 'Yüksek', why: ['göstergelerin çoğu aynı yönde', 'geçmiş testte belirgin üstünlük'] };
  }
  return { level: 'medium', text: 'Orta', why: [] };
}

// --- Sade gerekçe cümleleri ------------------------------------------------------------

const pctTr = (x, d = 1) => `%${(Math.abs(x) * 100).toFixed(d).replace('.', ',')}`;

export function factorSentence(id, f) {
  const r = f.raw || {};
  switch (id) {
    case 'trend':
      if (f.score === 100) return 'Fiyat 200 günlük ortalamanın üzerinde ve 50 günlük ortalama da yukarıda: uzun vadeli yön yukarı.';
      if (f.score === -100) return 'Fiyat 200 günlük ortalamanın altında: uzun vadeli yön aşağı.';
      return 'Uzun vadeli yön karışık: ortalamalar net bir yön göstermiyor.';
    case 'rsi': {
      const v = r.rsi.toFixed(0);
      if (r.rsi >= 70) return `RSI ${v}: son günlerde hızlı yükseldi, kısa vadede fazla ısınmış olabilir.`;
      if (r.rsi <= 30) return `RSI ${v}: son günlerde sert düştü, satışlar aşırıya kaçmış olabilir.`;
      if (r.rsi >= 60) return `RSI ${v}: kısa vadede alıcılar ağır basıyor.`;
      if (r.rsi <= 40) return `RSI ${v}: kısa vadede satıcılar ağır basıyor.`;
      return `RSI ${v}: kısa vadede ne aşırı alım ne aşırı satım var.`;
    }
    case 'peak':
      return r.drawdown > -0.01 ? 'Son bir yılın zirvesine çok yakın.' : `Son bir yılın zirvesinin ${pctTr(r.drawdown)} altında.`;
    case 'vol':
      if (r.rank >= 0.8) return 'Fiyat hareketleri son yıllara göre çok sert; risk yüksek.';
      if (r.rank <= 0.2) return 'Fiyat hareketleri son yıllara göre sakin.';
      return 'Fiyat hareketlerinin sertliği normal seviyede.';
    case 'fx':
      return r.change3m >= RULES.fxNeutral
        ? `Dolar/TL son 3 ayda ${pctTr(r.change3m)} arttı; TL'nin değer kaybı dövize bağlı varlıkları destekliyor.`
        : `Dolar/TL son 3 ayda ${r.change3m >= 0 ? pctTr(r.change3m) + ' arttı' : pctTr(r.change3m) + ' düştü'}; kurdan gelen destek zayıf.`;
    case 'news':
      if (f.score > 20) return 'Son haberlerin çoğu olumlu.';
      if (f.score < -20) return 'Son haberlerin çoğu olumsuz.';
      return 'Son haberler karışık ya da nötr.';
    default:
      return '';
  }
}

const CLOSING = {
  buy: 'Kademeli alım için uygun bir ortam görünüyor.',
  wait: 'Net bir sinyal yok; acele etmeden beklemek daha sakin bir seçenek.',
  expensive: 'Yeni alım için düşüşü beklemek daha sakin bir seçenek olabilir.',
  none: 'Yeterli ve güncel veri olmadığı için değerlendirme yapılmadı.',
};

export function riskNote(kind) {
  if (kind === 'crypto') return 'Kripto paralar kısa sürede çok sert düşebilir; kaybetmeyi göze alamayacağın parayla alma.';
  if (kind === 'fx') return 'Euro\'nun TL değeri hem euro/dolar paritesine hem dolar kuruna bağlıdır; döviz de değer kaybedebilir.';
  return 'Altın ve gümüş de kısa vadede düşebilir; kısa vadeli kazanç garantisi yoktur.';
}

/** En çok etki eden iki faktörün cümlesi + sonuç cümlesi (2–3 cümle). */
export function reasonSentences(result, factors) {
  if (result.label === 'none') return [CLOSING.none];
  const top = result.rows
    .filter((r) => r.contribution !== null)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 2)
    .map((r) => factorSentence(r.id, factors[r.id]));
  return [...top, CLOSING[result.label]];
}
