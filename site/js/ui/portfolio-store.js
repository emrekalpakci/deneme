// Portföyün telefonda saklanması ve yedek dosyası (indir / yükle).

import { load, save } from './store.js';
import { emptyPortfolio, validatePortfolioFile, PORTFOLIO_SCHEMA } from '../core/portfolio.js';

const KEY = 'portfolio';

export function loadPortfolio() {
  const p = load(KEY);
  if (!p || p.schemaVersion !== PORTFOLIO_SCHEMA || !Array.isArray(p.tx)) return emptyPortfolio();
  p.settings ||= { targets: {} };
  p.settings.targets ||= {};
  return p;
}

const listeners = new Set();

/** Portföy her kaydedildiğinde çağrılır (eşitleme bunu kullanır). */
export function onPortfolioSaved(fn) {
  listeners.add(fn);
}

/** silent: eşitlemeden gelen veriyi kaydederken kullanılır (zaman damgası ve bildirim değişmez). */
export function savePortfolio(p, { silent = false } = {}) {
  if (!silent) p.updatedAt = new Date().toISOString();
  const ok = save(KEY, p);
  if (!silent) for (const fn of listeners) fn(p);
  return ok;
}

/**
 * Yedekten yükleme: yedek telefondaki portföyün yerine geçer. Eşitleme açıkken diğer cihazdaki
 * eski işlemler geri gelmesin diye, yedekte olmayan işlemler silinmiş olarak işaretlenir.
 */
export function replaceWithBackup(current, backup) {
  const now = new Date().toISOString();
  const keep = new Set(backup.tx.map((t) => t.id));
  const tombstones = current.tx.filter((t) => !keep.has(t.id)).map((t) => ({ ...t, deleted: true, updatedAt: now }));
  const tx = backup.tx.map((t) => ({ ...t, updatedAt: t.updatedAt && t.updatedAt > now ? t.updatedAt : now }));
  const targets = Object.fromEntries(Object.entries(backup.settings?.targets || {}).map(([k, v]) => [k, { ...v, updatedAt: now }]));
  return { ...backup, settings: { ...(backup.settings || {}), targets }, tx: [...tx, ...tombstones] };
}

export function downloadBackup(p) {
  const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portfoy-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Yedek dosyasını okur; hatalıysa hiçbir şeyi değiştirmeden hata listesi döner. */
export async function readBackup(file) {
  try {
    const obj = JSON.parse(await file.text());
    const errors = validatePortfolioFile(obj);
    return errors.length ? { errors } : { portfolio: obj, errors: [] };
  } catch {
    return { errors: ['Dosya okunamadı. Bu uygulamanın indirdiği yedek dosyasını seçin.'] };
  }
}
