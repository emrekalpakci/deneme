// Telefondaki portföyün gizli GitHub deposuyla eşitlenmesi.
// Token sadece bu telefonda (tarayıcı depolaması) durur; hiçbir yere gönderilmez, sadece GitHub'a.

import { load, save, remove } from './store.js';
import { githubClient, syncPortfolio, parseRepo, ALERT_STATE_PATH } from '../core/sync.js';
import { loadPortfolio, savePortfolio, onPortfolioSaved } from './portfolio-store.js';

const CFG = 'sync';
const STATUS = 'syncStatus';
const TOKEN_RE = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/;
const DAY = 24 * 3600 * 1000;

export function getSyncConfig() {
  const c = load(CFG);
  return c?.token && c?.repo ? c : null;
}

export function getSyncStatus() {
  return load(STATUS);
}

/** Varsayılan depo adı: site adresindeki kullanıcı adı + "yatirim-verilerim". */
export function defaultRepo() {
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  return m ? `${m[1]}/yatirim-verilerim` : '';
}

export function defaultExpiry(now = Date.now()) {
  return new Date(now + 365 * DAY).toISOString().slice(0, 10);
}

const client = (cfg) => {
  const r = parseRepo(cfg.repo);
  return githubClient({ token: cfg.token, owner: r.owner, repo: r.repo });
};

/** Bilgileri denetler, depoya erişimi dener, kaydeder ve ilk eşitlemeyi yapar. */
export async function connect({ repo, token, expires }) {
  const r = parseRepo(repo);
  if (!r) return { ok: false, error: 'Depo adı "kullanıcı-adı/depo-adı" biçiminde olmalı (ör. emrekalpakci/yatirim-verilerim).' };
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) return { ok: false, error: 'Token "github_pat_" ile başlamalı. GitHub\'da oluşturduğun token\'ı tamamen kopyalayıp yapıştır.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires || '')) return { ok: false, error: 'Token bitiş tarihini seç.' };
  const cfg = { repo: `${r.owner}/${r.repo}`, token: t, expires };
  try {
    const info = await client(cfg).checkRepo();
    if (!info.private) return { ok: false, error: 'Bu depo herkese açık! Portföyün herkes tarafından görülebilir. Gizli (Private) bir depo kullan.' };
    if (info.canPush === false) return { ok: false, error: 'Token\'ın bu depoya yazma izni yok. Token\'da "Contents: Read and write" iznini seç.' };
    if (info.tokenExpires) cfg.expires = info.tokenExpires.slice(0, 10);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  save(CFG, cfg);
  const s = await syncNow();
  return s?.ok ? { ok: true } : { ok: false, error: s?.error || 'Eşitleme yapılamadı.' };
}

export function disconnect() {
  remove(CFG);
  remove(STATUS);
  alertCache = null;
  notify();
}

// --- Eşitleme ---------------------------------------------------------------------

const listeners = new Set();
export function onSyncChange(fn) {
  listeners.add(fn);
}
function notify(changed = false) {
  for (const fn of listeners) fn(changed);
}

let running = null;
let again = false;
let timer = null;

/** Hemen eşitler. Çalışan bir eşitleme varsa bitince bir kez daha çalışır. */
export function syncNow() {
  const cfg = getSyncConfig();
  if (!cfg) return Promise.resolve(null);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const before = JSON.stringify(loadPortfolio());
    let status;
    try {
      const r = await syncPortfolio({ client: client(cfg), local: loadPortfolio() });
      // Eşitleme sürerken telefonda yeni değişiklik yapıldıysa onu ezme: bir tur daha.
      const pulled = JSON.stringify(r.portfolio.tx) !== JSON.stringify(JSON.parse(before).tx) || JSON.stringify(r.portfolio.settings) !== JSON.stringify(JSON.parse(before).settings);
      if (JSON.stringify(loadPortfolio()) !== before) again = true;
      else savePortfolio(r.portfolio, { silent: true });
      status = { at: new Date().toISOString(), ok: true, pushed: r.pushed, pulled };
    } catch (err) {
      status = { at: new Date().toISOString(), ok: false, error: err.message };
    }
    save(STATUS, status);
    running = null;
    notify(JSON.stringify(loadPortfolio()) !== before);
    if (again) {
      again = false;
      scheduleSync(500);
    }
    return status;
  })();
  return running;
}

export function scheduleSync(ms = 1500) {
  if (!getSyncConfig()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

onPortfolioSaved(() => scheduleSync());

// --- Bildirim görevinin durumu (gizli depodan okunur) ---------------------------------------

let alertCache = null;

/** { state, telegram } ya da hata. 5 dakika önbellekte tutulur. */
export async function loadAlertStatus({ force = false } = {}) {
  const cfg = getSyncConfig();
  if (!cfg) return null;
  if (!force && alertCache && Date.now() - alertCache.at < 5 * 60 * 1000) return alertCache.value;
  let value;
  try {
    const c = client(cfg);
    const [state, telegram] = await Promise.all([c.readJson(ALERT_STATE_PATH), c.readJson('telegram.json')]);
    value = { ok: true, state: state?.data || null, telegramReady: !!telegram?.data?.chatId };
  } catch (err) {
    value = { ok: false, error: err.message };
  }
  alertCache = { at: Date.now(), value };
  return value;
}

/** Token bitişine kalan gün (yoksa null). */
export function tokenDaysLeft(cfg = getSyncConfig(), now = Date.now()) {
  if (!cfg?.expires) return null;
  return Math.floor((new Date(`${cfg.expires}T23:59:59Z`).getTime() - now) / DAY);
}
