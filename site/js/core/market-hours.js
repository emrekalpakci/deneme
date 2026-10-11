// Piyasa saatleri. Altın, gümüş ve döviz hafta sonu kapalıdır; kripto 7/24 açıktır.
// Kural (New York saatiyle): Cuma 17:00'den Pazar 18:00'e kadar kapalı.

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

function nyParts(ms) {
  const parts = Object.fromEntries(NY.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { day: parts.weekday, hour: Number(parts.hour) };
}

/** Metal ve döviz piyasası şu an açık mı? */
export function isFxMetalOpen(ms = Date.now()) {
  const { day, hour } = nyParts(ms);
  if (day === 'Sat') return false;
  if (day === 'Fri' && hour >= 17) return false;
  if (day === 'Sun' && hour < 18) return false;
  return true;
}

export function isMarketOpen(kind, ms = Date.now()) {
  return kind === 'crypto' ? true : isFxMetalOpen(ms);
}

/** Canlı fiyatın "eski" sayılacağı süre (piyasa açıkken). */
export const MAX_LIVE_AGE_MS = Object.freeze({
  crypto: 60 * 60 * 1000,
  metal: 2 * 60 * 60 * 1000,
  fx: 2 * 60 * 60 * 1000,
});
