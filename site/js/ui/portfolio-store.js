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

export function savePortfolio(p) {
  p.updatedAt = new Date().toISOString();
  return save(KEY, p);
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
