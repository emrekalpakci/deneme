// "Datum": her verinin değeri, zamanı, kaynağı ve durumu birlikte taşınır.
// Amaç: eksik ya da eski veri asla sessizce 0 ya da güncel değer gibi kullanılmasın.
//
// Biçim: { v: number|null, asOf: ISO metin|null, src: metin, st: 'ok'|'stale'|'unavailable', why?: metin }

export const ST = Object.freeze({ OK: 'ok', STALE: 'stale', UNAVAILABLE: 'unavailable' });

const RANK = { ok: 0, stale: 1, unavailable: 2 };

export function okDatum(v, asOf, src) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return unavailable(src, 'geçersiz sayı');
  if (!isValidTime(asOf)) return unavailable(src, 'zaman bilgisi yok');
  return { v, asOf: new Date(asOf).toISOString(), src, st: ST.OK };
}

export function unavailable(src, why) {
  return { v: null, asOf: null, src: src || '-', st: ST.UNAVAILABLE, why: why || 'veri alınamadı' };
}

export function isUsable(d) {
  return !!d && d.st !== ST.UNAVAILABLE && typeof d.v === 'number' && Number.isFinite(d.v);
}

/** Pozitif fiyat kontrolü: sıfır, negatif ya da sayı olmayan değerler "yok" sayılır. */
export function positivePrice(v, asOf, src) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return unavailable(src, 'fiyat sayı değil');
  if (v <= 0) return unavailable(src, 'fiyat sıfır ya da negatif');
  return okDatum(v, asOf, src);
}

export function ageMs(d, now = Date.now()) {
  if (!d?.asOf) return Infinity;
  return now - new Date(d.asOf).getTime();
}

/** Belirtilen süreden eski veriyi "eski" olarak işaretler (değeri korur, saklamaz). */
export function withStaleness(d, maxAgeMs, now = Date.now(), why = 'veri güncel değil') {
  if (!isUsable(d)) return d;
  if (ageMs(d, now) > maxAgeMs) return { ...d, st: ST.STALE, why };
  return d;
}

/**
 * Birden çok veriden yeni değer üretir (ör. gram fiyatı = ons × kur ÷ 31,1035).
 * Biri yoksa sonuç da yoktur; durum en kötüsü, zaman en eskisi olur.
 */
export function combine(parts, fn, src) {
  const missing = parts.find((p) => !isUsable(p));
  if (missing) return unavailable(src, `${missing.src}: ${missing.why || 'veri yok'}`);
  const v = fn(...parts.map((p) => p.v));
  if (typeof v !== 'number' || !Number.isFinite(v)) return unavailable(src, 'hesaplanamadı');
  const worst = parts.reduce((a, p) => (RANK[p.st] > RANK[a] ? p.st : a), ST.OK);
  const oldest = parts.reduce((a, p) => (new Date(p.asOf) < new Date(a) ? p.asOf : a), parts[0].asOf);
  const out = { v, asOf: oldest, src, st: worst };
  if (worst !== ST.OK) out.why = parts.find((p) => p.st === worst)?.why || 'veri güncel değil';
  return out;
}

function isValidTime(t) {
  if (t === null || t === undefined || t === '') return false;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms);
}
