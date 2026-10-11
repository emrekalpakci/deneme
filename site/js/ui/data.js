// Veri yükleme: önce internetten (önbelleği atlayarak), olmazsa son kayıtlı kopya.

import { load, save } from './store.js';
import { ASSETS } from '../core/assets.js';
import { parseGoldApi, parseCoinbaseSpot } from '../core/sources.js';

const SCHEMA = 1;

export async function loadMarket() {
  try {
    const res = await fetch(`data/market.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'veri dosyası henüz yok' : `sunucu hatası (${res.status})`);
    const data = await res.json();
    if (data?.schemaVersion !== SCHEMA) throw new Error('veri sürümü uyumsuz');
    save('market', data);
    // Servis çalışanı internet yokken kayıtlı kopyayı verir: bunu açıkça göster.
    if (res.headers.get('X-Yr-Kayitli')) return { data, fromCache: true, error: 'İnternet bağlantısı yok' };
    return { data, fromCache: false, error: null };
  } catch (err) {
    const cached = load('market');
    return { data: cached, fromCache: !!cached, error: describeLoadError(err) };
  }
}

/** Tarayıcının İngilizce hata metinleri yerine sade Türkçe açıklama. */
export function describeLoadError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'İnternet bağlantısı yok';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'Sunucu zamanında yanıt vermedi';
  if (err?.name === 'TypeError') return 'Sunucuya bağlanılamadı';
  if (err instanceof SyntaxError) return 'Veri dosyası okunamadı';
  return err?.message || 'Bilinmeyen hata';
}

let historyPromise = null;
/** Uzun geçmiş sadece gereken ekranlarda yüklenir. */
export function loadHistory() {
  if (!historyPromise) {
    historyPromise = fetch(`data/history.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((err) => {
        historyPromise = null;
        throw err;
      });
  }
  return historyPromise;
}

// --- Canlı fiyat (uygulama açıkken, en fazla dakikada bir) ------------------

const MIN_INTERVAL_MS = 60_000;
let lastLive = { at: 0, prices: null };

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Ons altın/gümüş (gold-api.com) ve kripto (Coinbase) anlık fiyatları. Kapalı piyasada metal istenmez.
 * Döviz (Euro) tarayıcıda canlı alınmaz; 30 dakikalık güncellemedeki değer kullanılır. */
export async function fetchLivePrices(market, { force = false } = {}) {
  if (!force && Date.now() - lastLive.at < MIN_INTERVAL_MS) return lastLive.prices;
  lastLive = { at: Date.now(), prices: lastLive.prices };
  const jobs = ASSETS.map(async (a) => {
    if (a.kind === 'fx') return null;
    if (a.kind === 'metal') {
      if (!market?.assets?.[a.id]?.marketOpen) return null;
      return [a.symbol, parseGoldApi(await getJson(`https://api.gold-api.com/price/${a.symbol}`), a.symbol)];
    }
    const json = await getJson(`https://api.coinbase.com/v2/prices/${a.symbol}-USD/spot`);
    return [a.symbol, parseCoinbaseSpot(json, new Date().toISOString(), a.symbol)];
  });
  const settled = await Promise.allSettled(jobs);
  const prices = {};
  for (const s of settled) if (s.status === 'fulfilled' && s.value) prices[s.value[0]] = s.value[1];
  lastLive = { at: lastLive.at, prices };
  return prices;
}

let newsPromise = null;
/** Haber dosyası (son 72 saat). Hata olursa bir sonraki çağrıda yeniden denenir. */
export function loadNews({ force = false } = {}) {
  if (!newsPromise || force) {
    newsPromise = fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'haber dosyası henüz yok' : `sunucu hatası (${r.status})`))))
      .catch((err) => {
        newsPromise = null;
        throw err;
      });
  }
  return newsPromise;
}
