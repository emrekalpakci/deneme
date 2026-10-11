// Piyasa özeti (market.json) üreten saf fonksiyonlar. Ağ isteği yapmaz; test edilebilir.

import { ASSETS, GRAMS_PER_TROY_OUNCE } from './assets.js';
import { Big, decFromNumber, toRoundedNumber } from './money.js';
import { ST, isUsable, withStaleness, unavailable, combine } from './datum.js';
import { gramUsdFromOunce, gramTryFromOunce, usdToTry } from './convert.js';
import { isMarketOpen, MAX_LIVE_AGE_MS } from './market-hours.js';
import { addDays, normalize, valueOn } from './series.js';

export const SCHEMA_VERSION = 1;
const G = new Big(GRAMS_PER_TROY_OUNCE);

const NY_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  hourCycle: 'h23',
});

/**
 * Fiyatın ait olduğu işlem günü (YYYY-AA-GG).
 * Kripto: UTC günü. Metal/döviz: New York günü; 18:00'den sonra ertesi seans,
 * hafta sonu ise Cuma seansı sayılır.
 */
export function tradingDate(kind, ms) {
  if (kind === 'crypto') return new Date(ms).toISOString().slice(0, 10);
  const p = Object.fromEntries(NY_DATE.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  let day = `${p.year}-${p.month}-${p.day}`;
  if (Number(p.hour) >= 18) day = addDays(day, 1);
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (wd === 6) day = addDays(day, -1);
  if (wd === 0) day = addDays(day, -2);
  return day;
}

/** Belirtilen günden önceki son kapanış. */
export function prevClose(points, day) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i][0] < day) return points[i];
  return null;
}

/** Varlığın birim başına USD günlük serisi (metalde gram, kriptoda adet). */
export function unitUsdSeries(asset, history) {
  const pts = history[`${asset.symbol}USD`] || [];
  if (asset.kind !== 'metal') return pts;
  return pts.map(([d, v]) => [d, toRoundedNumber(decFromNumber(v).div(G), 6)]);
}

/** USD serisini Dolar/TL ile TL serisine çevirir; kur bulunamayan günler atlanır (uydurma yok). */
export function toTrySeries(usdPoints, fxPoints) {
  const out = [];
  for (const [d, v] of usdPoints) {
    const r = valueOn(fxPoints, d, { ffill: true, maxGapDays: 5 });
    if (r) out.push([d, toRoundedNumber(decFromNumber(v).times(decFromNumber(r)), 4)]);
  }
  return out;
}

function pct(now, before) {
  if (!now || !before) return null;
  return toRoundedNumber(decFromNumber(now).div(decFromNumber(before)).minus('1').times('100'), 4);
}

/** Canlı veriye piyasa saatine göre "eski" işareti uygular. */
function applyFreshness(datum, kind, now) {
  if (!isUsable(datum)) return datum;
  if (!isMarketOpen(kind, now)) return datum; // Kapalı piyasada son fiyat eski sayılmaz, "kapalı" gösterilir.
  return withStaleness(datum, MAX_LIVE_AGE_MS[kind], now, 'fiyat uzun süredir güncellenmedi');
}

/**
 * @param {{now: number, live: Record<string, any>, history: Record<string, [string, number][]>,
 *          sources?: any[], buildId?: string}} input
 */
export function buildMarket({ now, live, history, sources = [], buildId = 'yerel' }) {
  const fxLive = applyFreshness(live.USDTRY || unavailable('-', 'kur alınamadı'), 'fx', now);
  const fxHist = normalize(history.USDTRY || []);
  const fxDay = tradingDate('fx', now);
  const fxPrev = prevClose(fxHist, fxDay);

  const market = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    buildId,
    fx: {
      USDTRY: {
        ...fxLive,
        marketOpen: isMarketOpen('fx', now),
        prevClose: fxPrev ? { date: fxPrev[0], v: fxPrev[1] } : null,
        changePct: isUsable(fxLive) && fxPrev ? pct(fxLive.v, fxPrev[1]) : null,
      },
    },
    assets: {},
    sources,
  };

  for (const asset of ASSETS) {
    market.assets[asset.id] = buildAsset(asset, { now, live, history, fxLive, fxHist });
  }
  return market;
}

function buildAsset(asset, { now, live, history, fxLive, fxHist }) {
  const kind = asset.kind;
  const raw = applyFreshness(live[asset.symbol] || unavailable('-', 'fiyat alınamadı'), kind, now);
  const out = {
    id: asset.id,
    name: asset.name,
    kind,
    unitLabel: asset.unitLabel,
    marketOpen: isMarketOpen(kind, now),
  };

  let usd;
  let tl;
  if (kind === 'metal') {
    out.ounceUsd = raw;
    usd = gramUsdFromOunce(raw);
    tl = gramTryFromOunce(raw, fxLive);
  } else {
    usd = raw;
    tl = usdToTry(raw, fxLive);
  }
  if (isUsable(usd)) usd.src = raw.src;
  if (isUsable(tl)) tl.src = `${raw.src} × ${fxLive.src}`;
  out.usd = usd;
  out.try = tl;

  // Önceki kapanış ve günlük değişim (aynı birimde).
  const usdSeries = normalize(unitUsdSeries(asset, history));
  const trySeries = toTrySeries(usdSeries, fxHist);
  const day = isUsable(raw) ? tradingDate(kind, new Date(raw.asOf).getTime()) : tradingDate(kind, now);
  const pu = prevClose(usdSeries, day);
  const pt = prevClose(trySeries, day);
  out.prevClose = pu ? { date: pu[0], usd: pu[1], try: pt && pt[0] === pu[0] ? pt[1] : null } : null;
  out.change = {
    usdPct: isUsable(usd) && pu ? pct(usd.v, pu[1]) : null,
    tryPct: isUsable(tl) && pt ? pct(tl.v, pt[1]) : null,
  };

  // Küçük grafik: son 30 kapanış (TL) + varsa bugünkü canlı fiyat.
  const spark = trySeries.filter((p) => p[0] < day).slice(-29);
  if (isUsable(tl)) spark.push([day, tl.v]);
  out.spark = { days: spark.map((p) => p[0]), try: spark.map((p) => p[1]) };
  out.historyDays = usdSeries.length;
  return out;
}

export { ST, combine };
