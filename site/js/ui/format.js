// Tarih/saat ve veri durumu metinleri (Türkiye saatiyle).

const TZ = 'Europe/Istanbul';
const timeFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayTimeFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Bugünse "14:07", değilse "9 Eki 15:30". */
export function formatWhen(iso, now = Date.now()) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateKey.format(d) === dateKey.format(new Date(now)) ? timeFmt.format(d) : dayTimeFmt.format(d);
}

export function formatDay(day) {
  return dayFmt.format(new Date(`${day}T12:00:00Z`));
}

/** "3 dk önce", "2 saat önce", "4 gün önce" */
export function formatAge(iso, now = Date.now()) {
  if (!iso) return '';
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} saat önce`;
  return `${Math.round(hours / 24)} gün önce`;
}

export function ageHours(iso, now = Date.now()) {
  return iso ? (now - new Date(iso).getTime()) / 3600000 : Infinity;
}
