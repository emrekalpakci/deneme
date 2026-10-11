// Ağ isteği yardımcısı: zaman aşımı, sınırlı yeniden deneme ve sade hata bilgisi.
// Hata mesajlarına asla yanıt gövdesi eklenmez (gizli veri log'a sızmasın diye).

export const USER_AGENT =
  'YatirimRehberi/1.0 (+https://github.com/emrekalpakci/deneme; kisisel kullanim)';

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * @param {string} url
 * @param {{timeoutMs?: number, retries?: number, headers?: Record<string,string>}} [opts]
 * @returns {Promise<{ok: boolean, status: number, ms: number, headers: Headers|null, text: string, error: string|null}>}
 */
export async function httpGet(url, opts = {}) {
  const { timeoutMs = 15000, retries = 1, headers = {} } = opts;
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      const text = await res.text();
      last = {
        ok: res.ok,
        status: res.status,
        ms: Date.now() - started,
        headers: res.headers,
        text,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
      if (res.ok || !RETRY_STATUSES.has(res.status)) return last;
    } catch (err) {
      last = {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        headers: null,
        text: '',
        error: describeError(err),
      };
    }
  }
  return last;
}

/** JSON isteği; ayrıştırma hatası gövdeyi göstermeden bildirilir. */
export async function httpGetJson(url, opts) {
  const res = await httpGet(url, opts);
  if (!res.ok) return { ...res, data: null };
  try {
    return { ...res, data: JSON.parse(res.text) };
  } catch {
    return { ...res, ok: false, data: null, error: 'JSON ayrıştırılamadı' };
  }
}

export function describeError(err) {
  if (!err) return 'bilinmeyen hata';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'zaman aşımı';
  const code = err.cause?.code || err.code;
  return code ? `ağ hatası (${code})` : `ağ hatası (${err.name || 'Error'})`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
