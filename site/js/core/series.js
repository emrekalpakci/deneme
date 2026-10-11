// Günlük fiyat serisi yardımcıları. Seri biçimi: [["YYYY-AA-GG", değer], ...], tarihe göre artan.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const valid = (p) =>
  Array.isArray(p) && typeof p[0] === 'string' && DAY_RE.test(p[0]) && typeof p[1] === 'number' && Number.isFinite(p[1]) && p[1] > 0;

/** Sıralar, aynı günü tekilleştirir (sonraki kazanır), geçersizleri atar. */
export function normalize(points) {
  const map = new Map();
  for (const p of points || []) if (valid(p)) map.set(p[0], p[1]);
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** İki seriyi birleştirir; aynı günde "overlay" kazanır. */
export function merge(base, overlay) {
  return normalize([...(base || []), ...(overlay || [])]);
}

export function isWeekend(day) {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

export function dropWeekends(points) {
  return points.filter((p) => !isWeekend(p[0]));
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

export const firstDate = (points) => (points.length ? points[0][0] : null);
export const lastDate = (points) => (points.length ? points[points.length - 1][0] : null);

/** Belirtilen günden (dahil) sonraki noktalar. */
export function sliceFrom(points, fromDay) {
  return points.filter((p) => p[0] >= fromDay);
}

/**
 * Belirtilen gündeki değer; o gün yoksa ve ffill=true ise önceki en yakın gün.
 * Kur gibi hafta sonu yayınlanmayan seriler için kullanılır. Bulunamazsa null.
 */
export function valueOn(points, day, { ffill = true, maxGapDays = 5 } = {}) {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= day) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const [d, v] = points[found];
  if (d === day) return v;
  if (!ffill) return null;
  const gap = (new Date(`${day}T00:00:00Z`) - new Date(`${d}T00:00:00Z`)) / 86400000;
  return gap <= maxGapDays ? v : null;
}

/** Ortak günlerde iki serinin farkı: sayı ve oransal farkın ortancası. */
export function overlapStats(a, b) {
  const mb = new Map(b);
  const diffs = [];
  for (const [d, v] of a) {
    const w = mb.get(d);
    if (w) diffs.push(Math.abs(v / w - 1));
  }
  diffs.sort((x, y) => x - y);
  const n = diffs.length;
  const median = n === 0 ? null : n % 2 ? diffs[(n - 1) / 2] : (diffs[n / 2 - 1] + diffs[n / 2]) / 2;
  return { n, median };
}

/**
 * Ana seriyi, yedek serinin daha eski verisiyle geriye doğru uzatır.
 * Sadece en az minDays ortak günde ortanca fark ≤ maxMedianDiff ise birleştirir.
 */
export function extendBackwards(primary, secondary, { minDays = 20, maxMedianDiff = 0.01 } = {}) {
  const p = normalize(primary);
  const s = normalize(secondary);
  const stats = overlapStats(p, s);
  const report = { overlapDays: stats.n, medianDiff: stats.median, joined: false, reason: '' };
  if (!p.length) return { points: p, report: { ...report, reason: 'ana seri boş' } };
  if (stats.n < minDays) return { points: p, report: { ...report, reason: 'ortak gün sayısı yetersiz' } };
  if (stats.median > maxMedianDiff) return { points: p, report: { ...report, reason: 'kaynaklar tutarsız' } };
  const start = firstDate(p);
  const older = s.filter((x) => x[0] < start);
  return { points: normalize([...older, ...p]), report: { ...report, joined: older.length > 0, olderDays: older.length } };
}
