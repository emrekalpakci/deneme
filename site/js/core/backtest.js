// Geçmiş veri testi: kural tabanlı etiket geçmişte her gün (sadece o güne kadarki veriyle) hesaplanır,
// 90 gün sonraki fiyatla karşılaştırılır. Haber ve kur faktörleri geçmişte test edilemez.

import { technicalSeries, technicalFactorsAt, scoreFactors, TESTED, SCORING_VERSION } from './scoring.js';
import { addDays } from './series.js';

export const HORIZON_DAYS = 90;
/** Al-sat başına toplam maliyet varsayımı (makas + komisyon). */
export const ROUND_TRIP_COST = Object.freeze({ metal: 0.01, crypto: 0.004 });

/** Wilson %95 güven aralığı (başarı oranı için). */
export function wilson(hits, n, z = 1.96) {
  if (!n) return [null, null];
  const p = hits / n;
  const den = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Her gün için etiket (sadece test edilebilen faktörlerle). */
export function labelSeries(values, kind) {
  const t = technicalSeries(values, kind);
  const labels = new Array(values.length).fill(null);
  const trend = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const f = technicalFactorsAt(values, t, i);
    if (f.trend.score === null || f.rsi.score === null || f.peak.score === null || f.vol.score === null) continue;
    labels[i] = scoreFactors(f, { only: TESTED }).label;
    trend[i] = f.trend.score;
  }
  return { labels, trend };
}

/** 90 takvim günü sonraki ilk kapanışa göre getiri; yoksa null. */
export function forwardReturns(dates, values, days = HORIZON_DAYS) {
  const out = new Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < values.length; i++) {
    const target = addDays(dates[i], days);
    if (j < i) j = i;
    while (j < dates.length && dates[j] < target) j++;
    if (j < dates.length) out[i] = values[j] / values[i] - 1;
  }
  return out;
}

/** Birbirinden en az 90 gün uzak sinyalleri seçer (aynı fırsat birden çok kez sayılmasın). */
function independent(idx, dates) {
  const picked = [];
  let next = '';
  for (const i of idx) {
    if (dates[i] >= next) {
      picked.push(i);
      next = addDays(dates[i], HORIZON_DAYS);
    }
  }
  return picked;
}

function verdict(nInd, edgePp, ciLow, baseline) {
  if (nInd < 10) return { level: 'insufficient', text: 'Kanıt yetersiz: bu sinyal geçmişte çok az, birbirinden bağımsız kez verilmiş.' };
  if (ciLow > baseline) return { level: 'moderate', text: 'Geçmişte rastgele günlere göre daha başarılı (kanıt orta düzeyde).' };
  if (edgePp >= 5) return { level: 'weak', text: 'Geçmişte rastgele günlerden biraz daha iyi, ama kanıt zayıf.' };
  if (edgePp > -5) return { level: 'none', text: 'Geçmişte rastgele bir günde işlem yapmaktan belirgin şekilde iyi değil.' };
  return { level: 'worse', text: 'Geçmişte rastgele bir günde işlem yapmaktan daha kötü sonuç verdi.' };
}

function signalStats(idx, ret, dates, success, baseline) {
  const rs = idx.map((i) => ret[i]);
  const hits = rs.filter(success).length;
  const hit = idx.length ? hits / idx.length : null;
  const ind = independent(idx, dates);
  const indHits = ind.filter((i) => success(ret[i])).length;
  const [ciLow, ciHigh] = wilson(indHits, ind.length);
  const edgePp = hit === null ? null : (hit - baseline) * 100;
  return {
    days: idx.length,
    hit,
    median: median(rs),
    worst: rs.length ? Math.min(...rs) : null,
    best: rs.length ? Math.max(...rs) : null,
    nInd: ind.length,
    indHit: ind.length ? indHits / ind.length : null,
    ciLow,
    ciHigh,
    baseline,
    edgePp,
    verdict: verdict(ind.length, edgePp ?? -100, ciLow ?? 0, baseline),
  };
}

/** Sinyale göre al-sat ile al-tut karşılaştırması (ertesi günün kapanışında işlem, maliyet dahil). */
function timingVsHold(values, labels, trend, start, cost) {
  const half = cost / 2;
  let inPos = false;
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  let trades = 0;
  for (let i = start + 1; i < values.length; i++) {
    if (inPos) equity *= values[i] / values[i - 1];
    const sig = labels[i - 1];
    if (!inPos && sig === 'buy') {
      inPos = true;
      equity *= 1 - half;
      trades++;
    } else if (inPos && (sig === 'expensive' || trend[i - 1] === -100)) {
      inPos = false;
      equity *= 1 - half;
    }
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity / peak - 1);
  }
  let hold = 1 - half;
  let hPeak = hold;
  let hDD = 0;
  for (let i = start + 1; i < values.length; i++) {
    hold *= values[i] / values[i - 1];
    hPeak = Math.max(hPeak, hold);
    hDD = Math.min(hDD, hold / hPeak - 1);
  }
  return { timing: { ret: equity - 1, maxDD, trades }, hold: { ret: hold - 1, maxDD: hDD } };
}

/**
 * @param {[string, number][]} points  kapanmış günlerin USD fiyatları (bugünkü geçici fiyat hariç)
 * @param {'metal'|'crypto'} kind
 */
export function backtestAsset(points, kind) {
  const dates = points.map((p) => p[0]);
  const values = points.map((p) => p[1]);
  const cost = ROUND_TRIP_COST[kind];
  const { labels, trend } = labelSeries(values, kind);
  const ret = forwardReturns(dates, values);
  const eligible = [];
  for (let i = 0; i < values.length; i++) if (labels[i] && labels[i] !== 'none' && ret[i] !== null) eligible.push(i);
  if (eligible.length < 250) {
    return { available: false, why: 'Geçmiş veri testi için yeterli veri yok (en az ~1,5 yıl gerekir).', scoringVersion: SCORING_VERSION };
  }
  const net = (r) => (1 + r) * (1 - cost) - 1;
  const netRet = ret.map((r) => (r === null ? null : net(r)));
  const up = (r) => r > 0;
  const down = (r) => r < 0;
  const baseUp = eligible.filter((i) => up(netRet[i])).length / eligible.length;
  const baseDown = eligible.filter((i) => down(ret[i])).length / eligible.length;
  const buyIdx = eligible.filter((i) => labels[i] === 'buy');
  const expIdx = eligible.filter((i) => labels[i] === 'expensive');
  const counts = { buy: buyIdx.length, wait: eligible.filter((i) => labels[i] === 'wait').length, expensive: expIdx.length };
  const start = eligible[0];
  return {
    available: true,
    scoringVersion: SCORING_VERSION,
    from: dates[start],
    to: dates[eligible[eligible.length - 1]],
    horizonDays: HORIZON_DAYS,
    cost,
    days: eligible.length,
    counts,
    baseline: { up: baseUp, down: baseDown },
    buy: signalStats(buyIdx, netRet, dates, up, baseUp),
    expensive: signalStats(expIdx, ret, dates, down, baseDown),
    ...timingVsHold(values, labels, trend, start, cost),
  };
}
