// Canlı fiyatları (ons altın/gümüş, kripto, Dolar/TL) yedekli kaynaklardan çeker.
// Kayıtlı son fiyattan çok farklı değer ancak ikinci bir kaynak doğrularsa kabul edilir.
// Veri görevi ve bildirim görevi bu fonksiyonu ortak kullanır.

import { ASSETS } from '../../site/js/core/assets.js';
import { isUsable, unavailable } from '../../site/js/core/datum.js';
import { firstUsable, metalProviders, cryptoProviders, fxProviders, usdTryProviders } from './fetchers.mjs';

export const JUMP = Object.freeze({ metal: 0.15, crypto: 0.3, fx: 0.1 });
const DEFAULT_PROVIDERS = { metal: metalProviders, crypto: cryptoProviders, currency: fxProviders, fx: usdTryProviders };

/**
 * @param {Record<string, number|undefined>} refs  karşılaştırma fiyatları: { XAU, XAG, BTC, ETH, USDTRY }
 * @param {{providers?: object, deadlineMs?: number}} [opts]
 *   providers: testler için değiştirilebilir; deadlineMs: bu süre dolunca bitmeyen fiyatlar "yok" sayılır
 * @returns {Promise<{live: Record<string, any>, sources: any[]}>}
 */
export async function fetchLivePrices(refs = {}, { providers = DEFAULT_PROVIDERS, deadlineMs = 0 } = {}) {
  const guard = (ref, max) => (d) => !ref || Math.abs(d.v / ref - 1) <= max;
  const jobs = [
    ...ASSETS.map((a) => {
      if (a.kind === 'metal') return [a.symbol, providers.metal(a.symbol), JUMP.metal];
      if (a.kind === 'fx') return [a.symbol, providers.currency(a.symbol), JUMP.fx];
      return [a.symbol, providers.crypto(a.symbol), JUMP.crypto];
    }),
    ['USDTRY', providers.fx(), JUMP.fx],
  ];
  const done = {};
  const all = Promise.all(
    jobs.map(async ([key, list, max]) => {
      done[key] = await firstUsable(list, { accept: guard(refs[key], max) });
    }),
  );
  if (deadlineMs > 0) {
    let timer;
    await Promise.race([all, new Promise((resolve) => (timer = setTimeout(resolve, deadlineMs)))]);
    clearTimeout(timer);
  } else {
    await all;
  }
  const live = {};
  const sources = [];
  for (const [key] of jobs) {
    const r = done[key] || { datum: unavailable('-', 'süre doldu (kaynaklar yanıt vermedi)'), attempts: [] };
    live[key] = r.datum;
    sources.push({ key, used: isUsable(r.datum) ? r.datum.src : null, confirmedBy: r.confirmedBy || null, attempts: r.attempts });
  }
  return { live, sources };
}
