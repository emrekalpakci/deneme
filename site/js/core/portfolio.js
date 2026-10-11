// Portföy hesapları (ortalama maliyet yöntemi). Tüm tutarlar big.js ile, metin olarak tutulur.
//
// İşlem kaydı:
// { id, type: 'buy'|'sell', asset, date: 'YYYY-AA-GG', qty: '2.5', amountTry: '16500.00',
//   feeTry: '25', priceUsd?: '…', fxRate?: '…', note?, createdAt, updatedAt, deleted? }
// amountTry = komisyon hariç işlem tutarı (miktar × birim fiyat). Birim fiyat bundan türetilir.

import { Big, dec } from './money.js';
import { ASSETS, getAsset } from './assets.js';
import { isUsable } from './datum.js';

export const PORTFOLIO_SCHEMA = 1;
const ZERO = new Big('0');
const HUNDRED = new Big('100');

export function emptyPortfolio() {
  return { schemaVersion: PORTFOLIO_SCHEMA, updatedAt: null, settings: { targets: {} }, tx: [] };
}

const active = (txs) => (txs || []).filter((t) => !t.deleted);

/** İşlemleri tarih (ve aynı gün için kayıt zamanı) sırasına koyar. */
export function sortTx(txs) {
  return [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || '').localeCompare(b.createdAt || '')));
}

/**
 * Pozisyonları hesaplar. Satış ortalama maliyeti değiştirmez; satılan kısmın maliyeti düşülür.
 * Elde olandan fazla satış bulunursa errors listesine yazılır ve o satış hesaba katılmaz.
 */
export function computePositions(txs) {
  const pos = {};
  const errors = [];
  for (const t of sortTx(active(txs))) {
    const p = (pos[t.asset] ||= { asset: t.asset, qty: ZERO, cost: ZERO, realized: ZERO, fees: ZERO, bought: ZERO, sold: ZERO, txCount: 0 });
    const qty = dec(t.qty);
    const amount = dec(t.amountTry);
    const fee = dec(t.feeTry || '0');
    if (t.type === 'buy') {
      p.qty = p.qty.plus(qty);
      p.cost = p.cost.plus(amount).plus(fee);
      p.bought = p.bought.plus(amount).plus(fee);
    } else if (t.type === 'sell') {
      if (qty.gt(p.qty)) {
        errors.push({ id: t.id, asset: t.asset, message: 'Elindekinden fazla satış' });
        continue;
      }
      const costOut = p.qty.eq('0') ? ZERO : p.cost.times(qty).div(p.qty);
      const proceeds = amount.minus(fee);
      p.realized = p.realized.plus(proceeds).minus(costOut);
      p.sold = p.sold.plus(proceeds);
      p.qty = p.qty.minus(qty);
      p.cost = p.qty.eq('0') ? ZERO : p.cost.minus(costOut);
    }
    p.fees = p.fees.plus(fee);
    p.txCount += 1;
  }
  for (const p of Object.values(pos)) p.avgCost = p.qty.gt('0') ? p.cost.div(p.qty) : null;
  return { positions: pos, errors };
}

/**
 * Güncel fiyatlarla değerleme. prices: { assetId: Datum (TL, birim başına) }.
 * Fiyatı olmayan pozisyonun değeri "yok" kalır, toplam "kısmi" işaretlenir (0 sayılmaz).
 */
export function valuePortfolio(txs, prices) {
  const { positions, errors } = computePositions(txs);
  const rows = [];
  let totalCost = ZERO;
  let totalValue = ZERO;
  let realized = ZERO;
  let partial = false;
  for (const asset of ASSETS) {
    const p = positions[asset.id];
    if (!p) continue;
    realized = realized.plus(p.realized);
    if (p.qty.eq('0')) {
      rows.push({ ...p, closed: true, value: null, unrealized: null, pct: null, price: null });
      continue;
    }
    totalCost = totalCost.plus(p.cost);
    const price = prices?.[asset.id];
    if (!isUsable(price)) {
      partial = true;
      rows.push({ ...p, closed: false, value: null, unrealized: null, pct: null, price: price || null });
      continue;
    }
    const value = p.qty.times(new Big(String(price.v)));
    const unrealized = value.minus(p.cost);
    const pct = p.cost.gt('0') ? unrealized.div(p.cost).times(HUNDRED) : null;
    totalValue = totalValue.plus(value);
    rows.push({ ...p, closed: false, value, unrealized, pct, price });
  }
  const openCostWithPrice = rows.filter((r) => r.value).reduce((s, r) => s.plus(r.cost), ZERO);
  const unrealized = totalValue.minus(openCostWithPrice);
  return {
    rows,
    errors,
    totals: {
      cost: totalCost,
      value: partial ? null : totalValue,
      valueKnown: totalValue,
      unrealized: partial ? null : unrealized,
      unrealizedKnown: unrealized,
      pct: !partial && totalCost.gt('0') ? unrealized.div(totalCost).times(HUNDRED) : null,
      realized,
      partial,
    },
  };
}

/** Kâr hedefi ve zarar sınırı fiyatları (TL, birim başına). */
export function targetLevels(avgCost, tpPct, slPct) {
  if (!avgCost) return null;
  return {
    takeProfit: avgCost.times(HUNDRED.plus(dec(tpPct))).div(HUNDRED),
    stopLoss: avgCost.times(HUNDRED.minus(dec(slPct))).div(HUNDRED),
  };
}

export function targetsFor(portfolio, assetId) {
  const a = getAsset(assetId);
  const t = portfolio?.settings?.targets?.[assetId] || {};
  return { tp: t.tp || a.defaults.tp, sl: t.sl || a.defaults.sl };
}

// --- Doğrulama -----------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^\d+(\.\d+)?$/;

/** Yeni ya da değişen işlemi kontrol eder. Hatalar sade Türkçe döner. */
export function validateTx(tx, existing = [], today = new Date().toISOString().slice(0, 10)) {
  const errs = [];
  if (!getAsset(tx.asset)) errs.push('Varlık seçin.');
  if (tx.type !== 'buy' && tx.type !== 'sell') errs.push('Alış ya da satış seçin.');
  if (!DAY_RE.test(tx.date || '')) errs.push('Tarih geçersiz.');
  else if (tx.date > today) errs.push('İleri bir tarih girilemez.');
  else if (tx.date < '2000-01-01') errs.push('Tarih 2000 yılından önce olamaz.');
  for (const [k, label] of [
    ['qty', 'Miktar'],
    ['amountTry', 'Tutar'],
  ]) {
    if (!NUM_RE.test(tx[k] || '')) errs.push(`${label} geçersiz.`);
    else if (new Big(tx[k]).lte('0')) errs.push(`${label} sıfırdan büyük olmalı.`);
  }
  if (tx.feeTry !== undefined && tx.feeTry !== '' && !NUM_RE.test(tx.feeTry)) errs.push('Komisyon geçersiz.');
  if (errs.length) return errs;
  if (tx.type === 'sell') {
    const others = active(existing).filter((t) => t.id !== tx.id);
    const { errors } = computePositions([...others, tx]);
    if (errors.some((e) => e.id === tx.id)) errs.push('Bu tarihte elindekinden fazla satış yapılamaz.');
  }
  if (tx.type === 'sell' && new Big(tx.feeTry || '0').gte(tx.amountTry)) errs.push('Komisyon satış tutarından büyük olamaz.');
  return errs;
}

/** İçe aktarılan yedek dosyasını kontrol eder. */
export function validatePortfolioFile(obj) {
  if (!obj || typeof obj !== 'object') return ['Dosya okunamadı.'];
  if (obj.schemaVersion !== PORTFOLIO_SCHEMA) return ['Dosya sürümü bu uygulamayla uyumlu değil.'];
  if (!Array.isArray(obj.tx)) return ['Dosyada işlem listesi yok.'];
  const errs = [];
  obj.tx.forEach((t, i) => {
    if (t.deleted) return;
    const e = validateTx(t, [], '9999-12-31');
    if (e.length) errs.push(`${i + 1}. işlem: ${e[0]}`);
  });
  const { errors } = computePositions(obj.tx);
  for (const e of errors) errs.push(`Fazla satış: ${getAsset(e.asset)?.name || e.asset}`);
  return errs;
}

/** Birim fiyat (TL) = tutar ÷ miktar. Sadece gösterim için. */
export function unitPrice(tx) {
  return dec(tx.amountTry).div(dec(tx.qty));
}

export function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
