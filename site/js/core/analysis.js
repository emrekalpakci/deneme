// Bir varlığın güncel analizi: göstergeler, faktör puanları, etiket, güven, gerekçe ve trend olayları.

import {
  technicalSeries,
  technicalFactorsAt,
  fxFactor,
  scoreFactors,
  confidence,
  reasonSentences,
  riskNote,
  LABELS,
  SCORING_VERSION,
  FACTORS,
} from './scoring.js';
import { ASSETS, isDollar } from './assets.js';
import { isUsable } from './datum.js';
import { unitUsdSeries, tradingDate } from './market.js';
import { normalize, merge } from './series.js';
import { backtestAsset } from './backtest.js';

/** Son birkaç gündeki trend olayları (satış sinyalleri ve bildirimler için). */
export function trendEvents(dates, values, t, lookback = 5) {
  const events = [];
  const n = values.length;
  for (let i = Math.max(1, n - lookback); i < n; i++) {
    const ma200 = t.ma200[i];
    const ma50 = t.ma50[i];
    if (ma200 === null) continue;
    // 200 günlük ortalamanın altına kapanış (öncesinde en az 5 gün üstündeyken)
    if (values[i] < ma200 && values[i - 1] >= t.ma200[i - 1]) {
      let above = 0;
      for (let k = i - 1; k >= 0 && k >= i - 5; k--) if (t.ma200[k] !== null && values[k] >= t.ma200[k]) above++;
      if (above >= 5) events.push({ type: 'below200', date: dates[i] });
    }
    if (ma50 !== null && t.ma50[i - 1] !== null && t.ma200[i - 1] !== null) {
      if (ma50 < ma200 && t.ma50[i - 1] >= t.ma200[i - 1]) events.push({ type: 'deathCross', date: dates[i] });
      if (ma50 > ma200 && t.ma50[i - 1] <= t.ma200[i - 1]) events.push({ type: 'goldenCross', date: dates[i] });
    }
  }
  return events;
}

/**
 * @param {{asset, points: [string, number][], fxPoints: [string, number][], stale?: boolean,
 *          news?: {score: number|null, n?: number}, backtest?: object}} input
 * points: birim başına USD günlük kapanışlar; son nokta bugünkü (canlı) fiyat olabilir.
 */
export function analyzeAsset({ asset, points, fxPoints = [], stale = false, news = null, backtest = null }) {
  const dates = points.map((p) => p[0]);
  const values = points.map((p) => p[1]);
  if (values.length < 30) {
    return { scoringVersion: SCORING_VERSION, label: 'none', labelText: LABELS.none, reasons: ['Geçmiş veri yetersiz; analiz yapılamadı.'], factors: [] };
  }
  const t = technicalSeries(values, asset.kind);
  const i = values.length - 1;
  const factors = technicalFactorsAt(values, t, i);
  factors.fx = fxFactor(fxPoints.map((p) => p[1]));
  factors.news = news && news.score !== null && news.score !== undefined ? { score: news.score, raw: { n: news.n } } : { score: null };
  const result = scoreFactors(factors, { stale });
  const bt = backtest?.available ? (result.label === 'buy' ? backtest.buy : result.label === 'expensive' ? backtest.expensive : null) : null;
  const conf = confidence({ ...result, stale, factors, kind: asset.kind, bt: bt && { ...bt, baseline: bt.baseline } });
  return {
    scoringVersion: SCORING_VERSION,
    asOf: dates[i],
    label: result.label,
    labelText: LABELS[result.label],
    total: result.total === null ? null : Math.round(result.total),
    availShare: result.availShare,
    confidence: conf,
    reasons: reasonSentences(result, factors),
    riskNote: riskNote(asset.kind, asset.symbol),
    factors: result.rows.map((r) => ({ ...r, raw: factors[r.id]?.raw || null })),
    indicators: {
      price: values[i],
      ma50: t.ma50[i],
      ma200: t.ma200[i],
      rsi: t.rsi[i],
      high: t.high[i],
      vol20: t.vol20[i],
      volRank: t.volRank[i],
    },
    events: trendEvents(dates, values, t),
    factorNames: Object.fromEntries(FACTORS.map((f) => [f.id, f.name])),
  };
}

/**
 * Piyasa özetindeki her varlığa analiz ve geçmiş test sonucunu ekler.
 * series: günlük kapanışlar (XAUUSD, …, USDTRY). Bugünkü canlı fiyat geçici son nokta olarak kullanılır.
 * news: { assetId: { score, n } } (5. adım). Analiz sadece doğrulanmış (eski olmayan) fiyatla etiket üretir.
 */
export function analyzeMarket(market, series, { news = {} } = {}) {
  for (const asset of ASSETS) {
    const m = market.assets?.[asset.id];
    if (!m) continue;
    // Dolar'ın analizi Dolar/TL kuru üzerinden yapılır (dolar fiyatı her zaman 1'dir);
    // bu yüzden "Dolar/TL trendi" göstergesi Dolar için ayrıca kullanılmaz.
    const dollar = isDollar(asset);
    const closed = normalize(dollar ? series.USDTRY || [] : unitUsdSeries(asset, series));
    const live = dollar ? m.try : m.usd;
    let points = closed;
    if (isUsable(live)) {
      const day = tradingDate(asset.kind, new Date(live.asOf).getTime());
      points = merge(closed, [[day, live.v]]);
    }
    const backtest = backtestAsset(closed, asset.kind);
    m.backtest = backtest;
    m.analysis = analyzeAsset({
      asset,
      points,
      fxPoints: dollar ? [] : normalize(series.USDTRY || []),
      stale: !isUsable(live) || live.st === 'stale',
      news: news[asset.id] || null,
      backtest,
    });
  }
  return market;
}
