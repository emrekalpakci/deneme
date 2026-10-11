// Bütçe planlayıcı: vade ve risk tercihine göre dağılım, yuvarlama ve aylık parçalı alım planı.
// Tutarlar big.js ile hesaplanır; parçaların toplamı her zaman bütçeye kuruşu kuruşuna eşittir.

import { Big, dec } from './money.js';
import { getAsset } from './assets.js';

export const CASH = 'nakit';
export const PLAN_ASSETS = ['gram-altin', 'gram-gumus', 'btc', 'eth'];
const CRYPTO = ['btc', 'eth'];

/** Başlangıç dağılımı (%). Toplamlar 100'dür. */
export const BASE = Object.freeze({
  short: {
    low: { [CASH]: 50, 'gram-altin': 40, 'gram-gumus': 10, btc: 0, eth: 0 },
    medium: { [CASH]: 35, 'gram-altin': 45, 'gram-gumus': 10, btc: 7, eth: 3 },
    high: { [CASH]: 25, 'gram-altin': 40, 'gram-gumus': 10, btc: 17, eth: 8 },
  },
  long: {
    low: { [CASH]: 20, 'gram-altin': 60, 'gram-gumus': 10, btc: 7, eth: 3 },
    medium: { [CASH]: 10, 'gram-altin': 55, 'gram-gumus': 10, btc: 17, eth: 8 },
    high: { [CASH]: 10, 'gram-altin': 40, 'gram-gumus': 10, btc: 27, eth: 13 },
  },
});

export const LIMITS = Object.freeze({ singleAssetMax: 60, cryptoMax: 40, minPartTry: '250', minPartPct: 5 });

/** Analiz etiketine göre ayar çarpanı (4. adımda kullanılır). */
export const TILT = Object.freeze({ buy: 1.25, wait: 1, expensive: 0.75, none: 0 });

/**
 * Yüzde ağırlıkları hesaplar. Yukarı ayar nakit payını başlangıcın altına indirmez;
 * aşağı ayar ve sınır aşımları nakite geçer. available[asset]=false olan varlık (fiyatı yok) 0 alır.
 */
export function targetWeights({ horizon, risk, labels = {}, available = {} }) {
  const base = BASE[horizon]?.[risk];
  if (!base) throw new Error('Geçersiz vade ya da risk');
  const notes = [];
  const w = {};
  for (const a of PLAN_ASSETS) {
    let m = TILT[labels[a] || 'wait'] ?? 1;
    if (available[a] === false) {
      m = 0;
      if (base[a] > 0) notes.push({ asset: a, text: 'Güncel fiyatı alınamadığı için bu planda yer verilmedi.' });
    }
    w[a] = base[a] * m;
  }
  const maxAssets = 100 - base[CASH];
  const sum = PLAN_ASSETS.reduce((s, a) => s + w[a], 0);
  if (sum > maxAssets) for (const a of PLAN_ASSETS) w[a] = (w[a] * maxAssets) / sum;
  for (const a of PLAN_ASSETS) w[a] = Math.min(w[a], LIMITS.singleAssetMax);
  const crypto = CRYPTO.reduce((s, a) => s + w[a], 0);
  if (crypto > LIMITS.cryptoMax) for (const a of CRYPTO) w[a] = (w[a] * LIMITS.cryptoMax) / crypto;
  w[CASH] = 100 - PLAN_ASSETS.reduce((s, a) => s + w[a], 0);
  return { weights: w, notes };
}

/** Bütçeye göre yuvarlama adımı: 50.000 TL → 100 TL, 5.000 TL → 10 TL, en fazla 1.000 TL. */
export function roundingStep(budget) {
  const b = dec(budget);
  const digits = b.round(0, Big.roundDown).toFixed(0).length; // tam kısmın basamak sayısı
  const exp = Math.max(0, digits - 1 - 2);
  return new Big('10').pow(Math.min(exp, 3));
}

/**
 * Dağılımı TL tutarlarına çevirir. Her parça adımın katına aşağı yuvarlanır;
 * çok küçük parçalar (max(250 TL, %5)) nakite eklenir; nakit = bütçe − parçalar.
 */
export function allocate(budget, weights) {
  const B = dec(budget);
  const step = roundingStep(B);
  const minPart = maxBig(new Big(LIMITS.minPartTry), B.times(String(LIMITS.minPartPct)).div('100'));
  const parts = [];
  let used = new Big('0');
  for (const a of PLAN_ASSETS) {
    const pct = weights[a] || 0;
    if (pct <= 0) continue;
    const raw = B.times(String(Number(pct.toFixed(8)))).div('100');
    const amount = raw.div(step).round(0, Big.roundDown).times(step);
    if (amount.lt(minPart) || amount.lte('0')) continue;
    parts.push({ asset: a, amount });
    used = used.plus(amount);
  }
  const cash = B.minus(used);
  return { parts, cash, step, minPart, budget: B };
}

function maxBig(a, b) {
  return a.gt(b) ? a : b;
}

/**
 * Aylık parçalı alım: her ay eşit tutar (kuruşa aşağı yuvarlı), kalan kuruşlar son aya eklenir.
 * Dönen satırlar: [{ month: 1, amounts: { asset: Big } , total: Big }]
 */
export function monthlyPlan(parts, months) {
  const n = Number(months);
  if (!Number.isInteger(n) || n < 1) throw new Error('Ay sayısı geçersiz');
  const rows = Array.from({ length: n }, (_, i) => ({ month: i + 1, amounts: {}, total: new Big('0') }));
  for (const p of parts) {
    const each = p.amount.div(String(n)).round(2, Big.roundDown);
    const last = p.amount.minus(each.times(String(n - 1)));
    rows.forEach((r, i) => {
      const v = i === n - 1 ? last : each;
      r.amounts[p.asset] = v;
      r.total = r.total.plus(v);
    });
  }
  return rows;
}

// --- Gerekçeler -----------------------------------------------------------------------

export const REASONS = Object.freeze({
  'gram-altin': 'Altın, TL\'nin değer kaybına karşı uzun dönemde koruma sağlamış, görece sakin bir varlık. Bu yüzden dağılımın ana parçası.',
  'gram-gumus': 'Gümüş altından daha oynak. Küçük bir pay, çeşitlendirme için.',
  btc: 'Bitcoin çok oynaktır; kısa sürede %30–50 düşebilir. Payı risk tercihine göre sınırlı tutuldu.',
  eth: 'Ethereum, Bitcoin\'den de oynak. Kriptonun en küçük payı.',
});

export function cashReason(horizon) {
  return horizon === 'short'
    ? 'Kısa vadede fiyatlar ters gidebilir. Paranın bir kısmını nakitte tutmak, zararda satmak zorunda kalma riskini azaltır. İstersen bu kısmı düşük riskli TL araçlarında değerlendirebilirsin (bu uygulamanın kapsamı dışında).'
    : 'Beklenmedik ihtiyaçlar ve fiyatlar düşerse alım fırsatı için küçük bir pay.';
}

export function horizonNote(horizon) {
  return horizon === 'short'
    ? '0–6 ay kısa bir süre. Bu sürede altın da kripto da zarar ettirebilir.'
    : 'Uzun vadede dalgalanmalar daha çok dengelenir, ama garanti yoktur.';
}

export function assetName(id) {
  return id === CASH ? 'Nakit (TL)' : getAsset(id)?.name || id;
}
