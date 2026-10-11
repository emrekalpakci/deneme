// Günlük geçmiş fiyatlar: "veri" dalında history/<SERİ>.json dosyalarında saklanır.
// Günde bir kez kaynaklardan yenilenir; kaynakların bir gün çalışmaması eski veriyi silmez.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { normalize, merge, dropWeekends, extendBackwards, overlapStats, utcDay } from '../../site/js/core/series.js';
import {
  xausGoldHistory,
  frankfurterSeries,
  frankfurterV1UsdTry,
  bitstampHistory,
  coinbaseRecent,
  currencyApiOn,
} from './fetchers.mjs';

export const HISTORY_START = '2016-01-01';
export const HISTORY_SCHEMA = 1;

/** Tek günlük, komşularından çok farklı (sıçrama) değerleri ayıklar. */
export function removeSpikes(points, maxJump) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[i - 1]?.[1];
    const next = points[i + 1]?.[1];
    const v = points[i][1];
    if (prev && next) {
      const jumpIn = Math.abs(v / prev - 1);
      const jumpOut = Math.abs(v / next - 1);
      const across = Math.abs(next / prev - 1);
      if (jumpIn > maxJump && jumpOut > maxJump && across < maxJump / 2) continue;
    }
    out.push(points[i]);
  }
  return out;
}

const clean = (points, { weekdaysOnly, maxJump }) => {
  const n = normalize(points);
  return removeSpikes(weekdaysOnly ? dropWeekends(n) : n, maxJump);
};

export const SERIES = {
  XAUUSD: {
    unit: 'USD/ons',
    weekdaysOnly: true,
    maxJump: 0.15,
    async fetch() {
      const [x, f] = await Promise.all([xausGoldHistory(), frankfurterSeries('XAU', 'USD', HISTORY_START)]);
      const primary = clean(x.points, this);
      const secondary = clean(f.points, this);
      const joined = extendBackwards(primary, secondary);
      const points = primary.length ? joined.points : secondary;
      const check = await sampleCheck(points, 'XAU');
      return {
        points,
        sources: primary.length ? (joined.report.joined ? 'xaus.com + Frankfurter (eski yıllar)' : 'xaus.com') : 'Frankfurter',
        report: {
          xaus: x.points.length,
          frankfurter: f.points.length,
          join: joined.report,
          currencyApiSample: check,
          errors: [x.why, f.why].filter(Boolean),
        },
      };
    },
  },
  XAGUSD: {
    unit: 'USD/ons',
    weekdaysOnly: true,
    maxJump: 0.2,
    async fetch() {
      const f = await frankfurterSeries('XAG', 'USD', HISTORY_START);
      const points = clean(f.points, this);
      const check = await sampleCheck(points, 'XAG');
      return {
        points,
        sources: 'Frankfurter (merkez bankaları)',
        report: { frankfurter: f.points.length, currencyApiSample: check, errors: [f.why].filter(Boolean) },
      };
    },
  },
  USDTRY: {
    unit: 'TL/USD',
    weekdaysOnly: true,
    maxJump: 0.15,
    async fetch() {
      const [t, e] = await Promise.all([frankfurterSeries('USD', 'TRY', HISTORY_START, 'TCMB'), frankfurterV1UsdTry(HISTORY_START)]);
      const tcmb = clean(t.points, this);
      const ecb = clean(e.points, this);
      const check = overlapStats(tcmb, ecb);
      const points = tcmb.length ? tcmb : ecb;
      return {
        points,
        sources: tcmb.length ? 'TCMB (Frankfurter)' : 'ECB (Frankfurter)',
        report: { tcmb: t.points.length, ecb: e.points.length, tcmbVsEcb: check, errors: [t.why, e.why].filter(Boolean) },
      };
    },
  },
  BTCUSD: cryptoSeries('BTC'),
  ETHUSD: cryptoSeries('ETH'),
};

/**
 * Bağımsız kontrol: serinin son iki yılından eşit aralıklı 12 gün seçip
 * currency-api'nin o günkü değeriyle karşılaştırır (ortanca oransal fark).
 */
async function sampleCheck(points, symbol, count = 12) {
  const recent = points.filter((p) => p[0] >= '2024-03-04');
  if (recent.length < count) return { n: 0, median: null };
  const step = Math.floor(recent.length / count);
  const picks = Array.from({ length: count }, (_, i) => recent[i * step]);
  const diffs = [];
  for (const [day, v] of picks) {
    const r = await currencyApiOn(day);
    const other = r?.[symbol];
    if (other && other.st === 'ok') diffs.push(Math.abs(v / other.v - 1));
  }
  diffs.sort((a, b) => a - b);
  const n = diffs.length;
  return { n, median: n ? diffs[Math.floor(n / 2)] : null, max: n ? diffs[n - 1] : null };
}

function cryptoSeries(symbol) {
  return {
    unit: 'USD',
    weekdaysOnly: false,
    maxJump: 0.4,
    async fetch() {
      const [b, c] = await Promise.all([bitstampHistory(symbol, HISTORY_START), coinbaseRecent(symbol)]);
      const bs = clean(b.points, this);
      const cb = clean(c.points, this);
      const check = overlapStats(bs, cb);
      // Bitstamp tutarsızsa son 300 gün için Coinbase kullanılır.
      const consistent = check.n >= 20 && check.median <= 0.01;
      const points = bs.length && (consistent || !cb.length) ? merge(bs, []) : merge(bs, cb);
      return {
        points,
        sources: bs.length ? 'Bitstamp' : 'Coinbase',
        report: { bitstamp: b.points.length, coinbase: c.points.length, bitstampVsCoinbase: check, errors: [b.why, c.why].filter(Boolean) },
      };
    },
  };
}

// --- Dosya işlemleri ---------------------------------------------------------

export async function loadHistory(dir, id) {
  try {
    const h = JSON.parse(await readFile(join(dir, 'history', `${id}.json`), 'utf8'));
    if (h.schemaVersion !== HISTORY_SCHEMA) return null;
    h.points = normalize(h.points);
    h.snapshots = normalize(h.snapshots || []);
    return h;
  } catch {
    return null;
  }
}

export async function saveHistory(dir, h) {
  await mkdir(join(dir, 'history'), { recursive: true });
  const body = { ...h, points: h.points, snapshots: h.snapshots };
  await writeFile(join(dir, 'history', `${h.id}.json`), `${JSON.stringify(body)}\n`);
}

/** Kaynak noktaları + kendi günlük kapanış kayıtlarımız (kayıtlar öncelikli). */
export function combined(h) {
  return h ? merge(h.points, h.snapshots) : [];
}

/**
 * Günde bir kez kaynaklardan yeniler. Yeni veri eskiyle birleştirilir (yeni değer kazanır);
 * kaynak bir gün boş dönerse eski veri korunur.
 */
export async function refreshHistory(dir, id, now = Date.now(), { force = false } = {}) {
  const spec = SERIES[id];
  const today = utcDay(now);
  const existing = (await loadHistory(dir, id)) || {
    schemaVersion: HISTORY_SCHEMA,
    id,
    unit: spec.unit,
    points: [],
    snapshots: [],
  };
  if (!force && existing.refreshedDay === today && existing.points.length) return { history: existing, changed: false };
  const fetched = await spec.fetch();
  const h = {
    ...existing,
    refreshedDay: today,
    updatedAt: new Date(now).toISOString(),
    sources: fetched.points.length ? fetched.sources : existing.sources,
    report: fetched.report,
    points: merge(existing.points, fetched.points),
  };
  return { history: h, changed: true };
}
