// Portföyün gizli GitHub deposuyla eşitlenmesi (GitHub Contents API).
// Telefon ve bildirim görevi aynı dosyayı (portfoy.json) kullanır.
//
// Kurallar:
// - İşlemler kimliklidir ve silinmez; silme "deleted: true" işaretiyle yapılır. Böylece iki
//   cihazdaki değişiklikler birleştirilebilir.
// - Aynı işlem iki tarafta farklıysa güncelleme zamanı (updatedAt) yeni olan kazanır;
//   zamanlar eşitse silinmiş olan kazanır.
// - Yazarken çakışma olursa (başka yerden yazılmış) dosya yeniden okunur, birleştirilir ve
//   tekrar yazılır (en fazla 3 deneme).
// - Token hiçbir mesajda ya da dosyada yer almaz.

import { emptyPortfolio, PORTFOLIO_SCHEMA } from './portfolio.js';

export const PORTFOLIO_PATH = 'portfoy.json';
export const ALERT_STATE_PATH = 'bildirim-durumu.json';
const MAX_ATTEMPTS = 3;
const API = 'https://api.github.com';

// --- Türkçe karakter güvenli base64 ------------------------------------------------

export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// --- Birleştirme ---------------------------------------------------------------------

const newer = (a, b) => (a?.updatedAt || '') > (b?.updatedAt || '');

function pickTx(a, b) {
  if (newer(a, b)) return a;
  if (newer(b, a)) return b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return a;
}

function mergeKeyed(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[k]) out[k] = b[k];
    else if (!b[k]) out[k] = a[k];
    else out[k] = newer(b[k], a[k]) ? b[k] : a[k];
  }
  return out;
}

function sortForFile(txs) {
  return [...txs].sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.createdAt || '').localeCompare(y.createdAt || '') || x.id.localeCompare(y.id));
}

/** İki portföyü kayıpsız birleştirir. Sonuç girdilerin sırasından bağımsızdır. */
export function mergePortfolios(local, remote) {
  const a = local || emptyPortfolio();
  const b = remote || emptyPortfolio();
  const byId = new Map();
  for (const t of [...(a.tx || []), ...(b.tx || [])]) {
    if (!t?.id) continue;
    const prev = byId.get(t.id);
    byId.set(t.id, prev ? pickTx(prev, t) : t);
  }
  const updated = [a.updatedAt, b.updatedAt].filter(Boolean).sort().at(-1) || null;
  return {
    schemaVersion: PORTFOLIO_SCHEMA,
    updatedAt: updated,
    settings: {
      ...(b.settings || {}),
      ...(a.settings || {}),
      targets: mergeKeyed(a.settings?.targets, b.settings?.targets),
      alerts: mergeKeyed({ v: a.settings?.alerts }, { v: b.settings?.alerts }).v || { weekly: true },
    },
    tx: sortForFile(byId.values()),
  };
}

/** Karşılaştırma için kararlı metin (anahtar sırası ve updatedAt farkı önemsiz). */
export function canonical(p) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
    return v;
  };
  const { updatedAt, ...rest } = p || {};
  return JSON.stringify(sortKeys({ ...rest, tx: sortForFile(rest.tx || []) }));
}

// --- GitHub istemcisi --------------------------------------------------------------------

export class SyncError extends Error {
  constructor(message, { status = 0, code = 'error' } = {}) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
    this.code = code;
  }
}

/** "kullanici/depo" biçimini denetler. */
export function parseRepo(text) {
  const m = String(text || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function statusMessage(status, what) {
  if (status === 401) return new SyncError('Token geçersiz ya da süresi dolmuş. Ayarlar\'dan yeni token gir.', { status, code: 'auth' });
  if (status === 403) return new SyncError(`Token'ın ${what} izni yok ya da GitHub istek sınırı doldu. Token'da "Contents: Read and write" izni olmalı.`, { status, code: 'forbidden' });
  if (status === 404) return new SyncError('Depo bulunamadı ya da token bu depoya erişemiyor. Depo adını ve token\'ın hangi depoya izin verdiğini kontrol et.', { status, code: 'notfound' });
  if (status === 409 || status === 422) return new SyncError('Dosya aynı anda başka yerden değişti.', { status, code: 'conflict' });
  return new SyncError(`GitHub hatası (${status}). Biraz sonra yeniden dene.`, { status, code: 'server' });
}

/**
 * @param {{token: string, owner: string, repo: string, fetch?: typeof fetch}} cfg
 */
export function githubClient({ token, owner, repo, fetch: f = globalThis.fetch }) {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

  async function call(url, init = {}) {
    try {
      return await f(url, { ...init, headers: { ...headers, ...(init.headers || {}) }, cache: 'no-store' });
    } catch {
      throw new SyncError('GitHub\'a bağlanılamadı. İnternet bağlantını kontrol et.', { code: 'network' });
    }
  }

  return {
    /** Depo erişimini dener; token'ın bitiş tarihini (GitHub bildiriyorsa) döner. */
    async checkRepo() {
      const res = await call(base);
      if (!res.ok) throw statusMessage(res.status, 'okuma');
      const info = await res.json();
      const exp = res.headers?.get?.('github-authentication-token-expiration') || null;
      return { private: !!info.private, canPush: info.permissions ? !!info.permissions.push : null, tokenExpires: exp };
    },

    /** Dosyayı okur: { data, sha } ya da dosya yoksa null. */
    async readJson(path) {
      const res = await call(`${base}/contents/${path}`);
      if (res.status === 404) {
        await this.checkRepo(); // depo da yoksa buradan anlaşılır bir hata çıkar
        return null;
      }
      if (!res.ok) throw statusMessage(res.status, 'okuma');
      const body = await res.json();
      if (body.type !== 'file' || typeof body.content !== 'string') throw new SyncError(`${path} okunamadı (dosya çok büyük ya da biçimi farklı).`, { code: 'format' });
      try {
        return { data: JSON.parse(decodeBase64Utf8(body.content)), sha: body.sha };
      } catch {
        throw new SyncError(`${path} bozuk görünüyor; içeriği okunamadı.`, { code: 'format' });
      }
    },

    async writeJson(path, data, sha, message) {
      const res = await call(`${base}/contents/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: encodeBase64Utf8(`${JSON.stringify(data, null, 2)}\n`), ...(sha ? { sha } : {}) }),
      });
      if (!res.ok) throw statusMessage(res.status, 'yazma');
      const body = await res.json();
      return { sha: body.content?.sha || null };
    },
  };
}

/**
 * Telefondaki portföyü gizli depodakiyle birleştirir ve gerekirse yazar.
 * @returns {Promise<{portfolio, pushed: boolean, attempts: number}>}
 */
export async function syncPortfolio({ client, local }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remote = await client.readJson(PORTFOLIO_PATH);
    if (remote && remote.data?.schemaVersion !== PORTFOLIO_SCHEMA) {
      throw new SyncError('Gizli depodaki portföy dosyası bu uygulama sürümüyle uyumlu değil.', { code: 'format' });
    }
    const merged = mergePortfolios(local, remote?.data);
    if (remote && canonical(merged) === canonical(remote.data)) {
      return { portfolio: { ...merged, updatedAt: remote.data.updatedAt || merged.updatedAt }, pushed: false, attempts: attempt };
    }
    merged.updatedAt = new Date().toISOString();
    try {
      await client.writeJson(PORTFOLIO_PATH, merged, remote?.sha, 'Portföy güncellendi (uygulama)');
      return { portfolio: merged, pushed: true, attempts: attempt };
    } catch (err) {
      if (err.code !== 'conflict') throw err;
      lastErr = err;
    }
  }
  throw new SyncError('Portföy kaydedilemedi: dosya başka yerden değişmeye devam ediyor. Birazdan yeniden dene.', { code: 'conflict', status: lastErr?.status || 409 });
}
