// İyi / orta / kötü senaryolar: önerilen dağılım geçmişte aynı süre tutulsaydı ne olurdu?
// Geçmiş verideki tüm dönemlere (haftalık kaydırarak) bakılır; %10, %50 ve %90'lık dilimler alınır.
// Sonuçlar TL bazında ve enflasyondan arındırılmamıştır. Geçmiş, geleceği garanti etmez.

import { getAsset } from './assets.js';
import { unitUsdSeries, toTrySeries } from './market.js';
import { normalize } from './series.js';

export const WEEKS = Object.freeze({ short: 26, long: 52 });
const MIN_WINDOWS = 26;
const MIN_SAMPLES = 104; // en az ~2 yıl ortak veri

/** history.json içeriğinden varlığın birim başına günlük TL serisi. */
export function tryDailySeries(assetId, historyJson) {
  const series = Object.fromEntries(Object.entries(historyJson?.series || {}).map(([k, v]) => [k, normalize(v.points || [])]));
  const asset = getAsset(assetId);
  if (!asset) return [];
  return toTrySeries(unitUsdSeries(asset, series), series.USDTRY || []);
}

/** Tüm varlıkların ortak günlerini bulur ve sondan başlayarak her 5 işlem gününden birini alır (≈ haftalık). */
export function alignWeekly(seriesByAsset) {
  const ids = Object.keys(seriesByAsset);
  if (!ids.length) return { dates: [], prices: {} };
  const maps = ids.map((id) => new Map(seriesByAsset[id]));
  const common = seriesByAsset[ids[0]].map((p) => p[0]).filter((d) => maps.every((m) => m.has(d)));
  const picked = [];
  for (let i = common.length - 1; i >= 0; i -= 5) picked.push(common[i]);
  picked.reverse();
  const prices = Object.fromEntries(ids.map((id, k) => [id, picked.map((d) => maps[k].get(d))]));
  return { dates: picked, prices };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(returns, aligned, span) {
  const sorted = [...returns].sort((a, b) => a - b);
  return {
    available: true,
    windows: returns.length,
    from: aligned.dates[0],
    to: aligned.dates[aligned.dates.length - 1],
    spanWeeks: span,
    bad: percentile(sorted, 0.1),
    mid: percentile(sorted, 0.5),
    good: percentile(sorted, 0.9),
    worst: sorted[0],
    best: sorted[sorted.length - 1],
    lossShare: returns.filter((r) => r < 0).length / returns.length,
  };
}

function check(aligned, span) {
  if (aligned.dates.length < MIN_SAMPLES) return 'Bu varlıkların ortak geçmiş verisi 2 yıldan az; senaryo hesaplanamadı.';
  if (aligned.dates.length - span < MIN_WINDOWS) return 'Yeterli geçmiş dönem yok; senaryo hesaplanamadı.';
  return null;
}

/**
 * Tek seferde alım. weights: { assetId: bütçe içindeki pay (0–1) }; nakit getirisi 0 kabul edilir.
 * Dönüş değerleri oransal getiridir (0,12 = %12).
 */
export function lumpSumScenarios(weights, aligned, spanWeeks) {
  const why = check(aligned, spanWeeks);
  if (why) return { available: false, why };
  const ids = Object.keys(weights).filter((id) => weights[id] > 0);
  const returns = [];
  for (let i = 0; i + spanWeeks < aligned.dates.length; i++) {
    let r = 0;
    for (const id of ids) r += weights[id] * (aligned.prices[id][i + spanWeeks] / aligned.prices[id][i] - 1);
    returns.push(r);
  }
  return summarize(returns, aligned, spanWeeks);
}

/** Aylık parçalı alım: her ay eşit tutar alınır, plan bitince değer ölçülür. */
export function monthlyBuyScenarios(weights, aligned, months) {
  const offsets = Array.from({ length: months }, (_, k) => Math.round((k * 52) / 12));
  const end = Math.round((months * 52) / 12);
  const why = check(aligned, end);
  if (why) return { available: false, why };
  const ids = Object.keys(weights).filter((id) => weights[id] > 0);
  const returns = [];
  for (let i = 0; i + end < aligned.dates.length; i++) {
    let value = 0;
    let invested = 0;
    for (const id of ids) {
      const perMonth = weights[id] / months;
      let units = 0;
      for (const off of offsets) units += perMonth / aligned.prices[id][i + off];
      value += units * aligned.prices[id][i + end];
      invested += weights[id];
    }
    returns.push(value - invested); // nakit kısmı 0 getiri; oran tüm bütçeye göre
  }
  return summarize(returns, aligned, end);
}

/** Dolar/TL günlük serisi (history.json içinden). */
export function fxDailySeries(historyJson) {
  return normalize(historyJson?.series?.USDTRY?.points || []);
}

/** TL fiyatlarını aynı günün kuruna bölerek dolar bazına çevirir (karşılaştırma için). */
export function toUsdAligned(aligned, fxKey = 'USDTRY') {
  const fx = aligned.prices[fxKey];
  const prices = {};
  for (const [id, arr] of Object.entries(aligned.prices)) if (id !== fxKey) prices[id] = arr.map((v, i) => v / fx[i]);
  return { dates: aligned.dates, prices };
}
