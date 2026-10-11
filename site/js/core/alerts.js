// Telegram bildirim kuralları (saf fonksiyonlar; ağ isteği yapmaz).
// Bildirim görevi bunları 30 dakikada bir çalıştırır. Uygulamadaki satış sinyalleriyle aynı
// kuralları (signals.js) kullanır.
//
// Tekrarı önleme:
// - Her uyarının bir anahtarı vardır: "varlık|kural|seviye" (ör. "gram-altin|tp|6095.00").
// - Gönderilen anahtar "etkin" kalır; fiyat seviyeden %3 geri dönünce silinir (yeniden kurulur).
// - Yeni alım ortalama maliyeti, dolayısıyla seviyeyi değiştirir: yeni seviye = yeni anahtar.
// - Önce mesaj gönderilir, sonra kayıt yazılır. Gönderilemeyen uyarı kaydedilmez, sonraki
//   çalıştırmada yeniden denenir.
// - Fiyat taze değilse (75 dakikadan eski) uyarı gönderilmez; piyasa kapalıysa son fiyat geçerlidir.

import { Big, dec, formatTry, formatPercent, formatQuantity, formatDecimal } from './money.js';
import { ASSETS, getAsset } from './assets.js';
import { isUsable } from './datum.js';
import { isMarketOpen } from './market-hours.js';
import { computePositions, targetsFor, targetLevels, valuePortfolio } from './portfolio.js';
import { positionSignals } from './signals.js';

export const ALERT_STATE_SCHEMA = 1;
export const MAX_PRICE_AGE_MS = 75 * 60 * 1000;
const MAX_CLOSED_AGE_MS = 4 * 24 * 3600 * 1000;
const STALE_NOTICE_AFTER_MS = 3 * 3600 * 1000;
const REARM = '0.03';
const TREND_KEEP_MS = 30 * 24 * 3600 * 1000;
const RECENT_MAX = 20;
const DISCLAIMER = 'Bu bilgilendirmedir, yatırım tavsiyesi değildir.';

export function emptyAlertState() {
  return { schemaVersion: ALERT_STATE_SCHEMA, lastRunAt: null, lastSavedAt: null, lastResult: null, active: {}, staleSince: {}, lastStaleNotice: null, lastHeartbeat: null, recent: [] };
}

// --- Zaman yardımcıları (Türkiye saati) ---------------------------------------------

const TZ = 'Europe/Istanbul';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const wdHour = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
const whenFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const istanbulDay = (ms) => dayKey.format(new Date(ms));
const when = (iso) => whenFmt.format(new Date(iso));

/** Pazartesi tarihi (Türkiye saatiyle) haftanın anahtarı olarak kullanılır. */
export function weekKey(ms) {
  const d = new Date(`${istanbulDay(ms)}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function isHeartbeatTime(ms) {
  const p = Object.fromEntries(wdHour.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return p.weekday === 'Mon' && Number(p.hour) >= 9;
}

// --- Fiyatın tazeliği ------------------------------------------------------------------

function partFresh(d, kind, now) {
  if (!isUsable(d) || d.st !== 'ok') return false;
  const age = now - new Date(d.asOf).getTime();
  if (!isMarketOpen(kind, now)) return age <= MAX_CLOSED_AGE_MS;
  return age <= MAX_PRICE_AGE_MS;
}

/** Varlığın TL fiyatı uyarı için yeterince taze mi? (varlık fiyatı ve kur ayrı ayrı denetlenir) */
export function priceFreshness(market, asset, now) {
  const a = market?.assets?.[asset.id];
  const own = asset.kind === 'metal' ? a?.ounceUsd : a?.usd;
  const fx = market?.fx?.USDTRY;
  if (!isUsable(a?.try)) return { fresh: false, why: a?.try?.why || 'fiyat yok' };
  if (!partFresh(own, asset.kind, now)) return { fresh: false, why: `${asset.shortName} fiyatı güncel değil` };
  if (!partFresh(fx, 'fx', now)) return { fresh: false, why: 'Dolar/TL kuru güncel değil' };
  return { fresh: true, price: a.try.v, asOf: own.asOf, marketOpen: isMarketOpen(asset.kind, now) };
}

// --- Mesaj metinleri -----------------------------------------------------------------------

function unitOf(asset) {
  return asset.kind === 'metal' ? 'g' : asset.unitLabel;
}

function messageText({ asset, pos, sig, price, asOf, marketOpen, tp, sl, levels, plPct, prefix }) {
  const u = unitOf(asset);
  const icon = sig.type === 'tp' || sig.type === 'tp2' ? '🔔' : '⚠️';
  const value = pos.qty.times(new Big(String(price)));
  const plTry = value.minus(pos.cost);
  const lines = [
    `${prefix}${icon} ${asset.name}: ${sig.title}`,
    `Fiyat: ${formatTry(String(price))}/${u} (${when(asOf)}${marketOpen ? '' : ', piyasa kapalı, son fiyat'})`,
    `Ortalama maliyetin: ${formatTry(pos.avgCost)}/${u} · Elindeki: ${formatQuantity(pos.qty, asset.qtyDecimals, asset.unitLabel)}`,
    `Kâr/zarar: ${formatPercent(plPct.round(2), 2, { signed: true })} (${plTry.gte('0') ? '+' : ''}${formatTry(plTry)})`,
  ];
  if (sig.type === 'tp') lines.push(`Kâr hedefin: +%${formatDecimal(tp, 2, { trimZeros: true })} → ${formatTry(levels.takeProfit)}/${u}`);
  if (sig.type === 'tp2') lines.push(`Kâr hedefinin iki katı: +%${formatDecimal(dec(tp).times('2'), 2, { trimZeros: true })}`);
  if (sig.type === 'sl') lines.push(`Zarar sınırın: −%${formatDecimal(sl, 2, { trimZeros: true })} → ${formatTry(levels.stopLoss)}/${u}`);
  lines.push('', sig.text, '', DISCLAIMER);
  return lines.join('\n');
}

// --- Plan ---------------------------------------------------------------------------------

const ruleOf = (key) => key.split('|')[1];
const assetOf = (key) => key.split('|')[0];

/**
 * Bu çalıştırmada gönderilecek mesajları ve yeni durumu hazırlar (henüz göndermez).
 * @param {{portfolio, market, events?: Record<string, {type: string, date: string}[]>, state?, now: number,
 *          prefix?: string, heartbeat?: boolean}} input
 * @returns {{messages: {keys: string[], asset: string|null, kind: string, title: string, text: string}[],
 *            active: Record<string, any>, staleSince: Record<string, string>, stale: {asset: string, why: string}[], openCount: number}}
 */
export function planAlerts({ portfolio, market, events = {}, state = emptyAlertState(), now, prefix = '', heartbeat = true }) {
  const prev = state.active || {};
  const active = {};
  const messages = [];
  const stale = [];
  const staleSince = {};
  const { positions } = computePositions(portfolio?.tx || []);
  const open = ASSETS.filter((a) => positions[a.id]?.qty.gt('0'));

  // Trend anahtarları açık pozisyondan bağımsız olarak 30 gün saklanır (aynı olay tekrar gelmesin).
  for (const [k, v] of Object.entries(prev)) {
    if (ruleOf(k) === 'trend' && now - new Date(v.sentAt).getTime() < TREND_KEEP_MS) active[k] = v;
  }

  for (const asset of open) {
    const pos = positions[asset.id];
    const f = priceFreshness(market, asset, now);
    if (!f.fresh) {
      stale.push({ asset: asset.id, why: f.why });
      staleSince[asset.id] = state.staleSince?.[asset.id] || new Date(now).toISOString();
      // Fiyat yokken eski kayıtlar olduğu gibi korunur.
      for (const [k, v] of Object.entries(prev)) if (assetOf(k) === asset.id) active[k] = v;
      continue;
    }
    const { tp, sl } = targetsFor(portfolio, asset.id);
    const levels = targetLevels(pos.avgCost, tp, sl);
    const tp2Level = pos.avgCost.times(new Big('100').plus(dec(tp).times('2'))).div('100');
    const { plPct, signals } = positionSignals({ avgCost: pos.avgCost, price: f.price, tp, sl, events: events[asset.id] || [] });
    const price = new Big(String(f.price));
    const lvl = { tp: levels.takeProfit, tp2: tp2Level, sl: levels.stopLoss };
    const keyOf = (rule) => `${asset.id}|${rule}|${lvl[rule].toFixed(2)}`;
    const inBand = (rule) =>
      rule === 'sl' ? price.lte(lvl.sl.times(new Big('1').plus(REARM))) : price.gte(lvl[rule].times(new Big('1').minus(REARM)));

    // Mevcut seviyedeki etkin kayıtlar, fiyat %3 geri dönmediyse korunur.
    for (const rule of ['tp', 'tp2', 'sl']) {
      const k = keyOf(rule);
      if (prev[k] && inBand(rule)) active[k] = prev[k];
    }

    const ctx = { asset, pos, price: f.price, asOf: f.asOf, marketOpen: f.marketOpen, tp, sl, levels, plPct, prefix };
    const byType = Object.fromEntries(signals.map((s) => [s.type, s]));
    if (byType.tp2 && !active[keyOf('tp2')]) {
      messages.push({ keys: [keyOf('tp2'), keyOf('tp')], asset: asset.id, kind: 'tp2', title: byType.tp2.title, text: messageText({ ...ctx, sig: byType.tp2 }) });
    } else if (byType.tp && !active[keyOf('tp')]) {
      messages.push({ keys: [keyOf('tp')], asset: asset.id, kind: 'tp', title: byType.tp.title, text: messageText({ ...ctx, sig: byType.tp }) });
    }
    if (byType.sl && !active[keyOf('sl')]) {
      messages.push({ keys: [keyOf('sl')], asset: asset.id, kind: 'sl', title: byType.sl.title, text: messageText({ ...ctx, sig: byType.sl }) });
    }
    for (const e of events[asset.id] || []) {
      if (e.type !== 'below200' && e.type !== 'deathCross') continue;
      const k = `${asset.id}|trend|${e.type}|${e.date}`;
      if (active[k]) continue;
      const sig = positionSignals({ avgCost: pos.avgCost, price: f.price, tp, sl, events: [e] }).signals.find((s) => s.type === 'trend');
      if (sig) messages.push({ keys: [k], asset: asset.id, kind: 'trend', title: sig.title, text: messageText({ ...ctx, sig }) });
    }
  }

  // Uzun süredir fiyat alınamıyorsa günde en fazla bir kez haber ver.
  const today = istanbulDay(now);
  const longStale = stale.filter((s) => now - new Date(staleSince[s.asset]).getTime() >= STALE_NOTICE_AFTER_MS);
  if (longStale.length && state.lastStaleNotice !== today) {
    const names = longStale.map((s) => `${getAsset(s.asset).name} (${s.why})`).join(', ');
    messages.push({
      keys: [],
      asset: null,
      kind: 'stale',
      title: 'Veri alınamıyor',
      text: `${prefix}ℹ️ Veri alınamıyor\n3 saattir şu varlıklar için güncel fiyat alınamadı: ${names}.\nBu sürede bu varlıklar için uyarı gönderilmiyor. Kaynaklar düzelince kendiliğinden devam eder. Bu mesaj günde en fazla bir kez gelir.`,
    });
  }

  // Haftalık "sistem çalışıyor" özeti (Pazartesi 09:00'dan sonra, haftada bir).
  const week = weekKey(now);
  if (heartbeat && portfolio?.settings?.alerts?.weekly !== false && isHeartbeatTime(now) && state.lastHeartbeat !== week) {
    messages.push({ keys: [], asset: null, kind: 'heartbeat', title: 'Haftalık özet', text: heartbeatText({ portfolio, market, state, now, prefix, open, stale }) });
  }

  return { messages, active, staleSince, stale, openCount: open.length };
}

function heartbeatText({ portfolio, market, state, now, prefix, open, stale }) {
  const lines = [`${prefix}✅ Haftalık özet: bildirim sistemi çalışıyor.`];
  const week = (state.recent || []).filter((r) => r.kind !== 'heartbeat' && now - new Date(r.at).getTime() < 7 * 24 * 3600 * 1000);
  lines.push(`Son 7 günde gönderilen uyarı: ${week.length}.`);
  if (!open.length) {
    lines.push('Portföyünde açık pozisyon yok; takip edilecek bir şey bulunmuyor.');
  } else {
    const prices = Object.fromEntries(ASSETS.map((a) => [a.id, market?.assets?.[a.id]?.try]));
    const v = valuePortfolio(portfolio.tx, prices);
    const t = v.totals;
    if (t.partial) lines.push(`Bazı fiyatlar alınamadığı için toplam değer eksik: bilinen değer ${formatTry(t.valueKnown)}.`);
    else lines.push(`Portföy değeri: ${formatTry(t.value)} · Kâr/zarar: ${t.unrealized.gte('0') ? '+' : ''}${formatTry(t.unrealized)}${t.pct ? ` (${formatPercent(t.pct.round(2), 2, { signed: true })})` : ''}`);
    if (stale.length) lines.push(`Şu an fiyatı alınamayan: ${stale.map((s) => getAsset(s.asset).name).join(', ')}.`);
  }
  lines.push('', 'Bu mesajı istemiyorsan uygulamada Ayarlar → Telegram bölümünden kapatabilirsin.');
  return lines.join('\n');
}

/**
 * Gönderim sonuçlarını duruma işler. Sadece başarıyla gönderilen uyarılar "etkin" olur.
 * @param {{state, plan, sent: boolean[], now: number, result: string}} input
 */
export function nextAlertState({ state = emptyAlertState(), plan, sent, now, result }) {
  const at = new Date(now).toISOString();
  const next = {
    ...emptyAlertState(),
    ...state,
    schemaVersion: ALERT_STATE_SCHEMA,
    lastRunAt: at,
    lastResult: result,
    active: { ...plan.active },
    staleSince: plan.staleSince,
    recent: [...(state.recent || [])],
  };
  plan.messages.forEach((m, i) => {
    if (!sent[i]) return;
    for (const k of m.keys) next.active[k] = { sentAt: at };
    if (m.kind === 'stale') next.lastStaleNotice = istanbulDay(now);
    if (m.kind === 'heartbeat') next.lastHeartbeat = weekKey(now);
    next.recent.unshift({ at, kind: m.kind, asset: m.asset, title: m.title });
  });
  next.recent = next.recent.slice(0, RECENT_MAX);
  return next;
}

/** Durum dosyası yazılmalı mı? Önemli değişiklikte hemen, yoksa 3 saatte bir ("görev çalışıyor" kaydı). */
export function shouldSaveState(prev, next, now) {
  const strip = ({ lastRunAt, lastSavedAt, ...rest }) => JSON.stringify(rest);
  if (!prev || strip(prev) !== strip(next)) return true;
  return !prev.lastSavedAt || now - new Date(prev.lastSavedAt).getTime() >= 3 * 3600 * 1000;
}
