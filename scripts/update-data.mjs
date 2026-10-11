// Veri görevi (30 dakikada bir, GitHub Actions):
// 1) Geçmiş fiyatları günde bir kez yeniler ("veri" dalı)
// 2) Canlı fiyatları yedekli kaynaklardan çeker, ani sıçramaları ikinci kaynakla doğrular
// 3) site/data/market.json ve history.json dosyalarını üretir
// Bu betik sadece herkese açık piyasa verisiyle çalışır; kişisel veri yoktur.
//
// Ortam değişkenleri: VERI_DIR (varsayılan ./veri), SITE_DIR (varsayılan ./site), BUILD_ID

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSETS } from '../site/js/core/assets.js';
import { buildMarket, tradingDate } from '../site/js/core/market.js';
import { analyzeMarket } from '../site/js/core/analysis.js';
import { isUsable } from '../site/js/core/datum.js';
import { merge } from '../site/js/core/series.js';
import { firstUsable, metalProviders, cryptoProviders, usdTryProviders } from './lib/fetchers.mjs';
import { SERIES, refreshHistory, saveHistory, combined } from './lib/history.mjs';

const VERI_DIR = process.env.VERI_DIR || 'veri';
const SITE_DIR = process.env.SITE_DIR || 'site';
const BUILD_ID = process.env.BUILD_ID || 'yerel';
const JUMP = { metal: 0.15, crypto: 0.3, fx: 0.1 };

const now = Date.now();
const log = (...a) => console.log(...a);

// 1) Geçmiş
const histories = {};
let historyChanged = false;
for (const id of Object.keys(SERIES)) {
  const { history, changed } = await refreshHistory(VERI_DIR, id, now);
  histories[id] = history;
  if (changed) {
    historyChanged = true;
    const r = history.report || {};
    log(`Geçmiş ${id}: ${history.points.length} gün (${history.sources || '-'}) ${JSON.stringify(r)}`);
  }
}
const lastClose = (id) => combined(histories[id]).at(-1)?.[1];

// 2) Canlı fiyatlar
const guard = (ref, max) => (d) => !ref || Math.abs(d.v / ref - 1) <= max;
const live = {};
const sources = [];
async function fetchLive(key, providers, ref, max) {
  const r = await firstUsable(providers, { accept: guard(ref, max) });
  live[key] = r.datum;
  sources.push({ key, used: isUsable(r.datum) ? r.datum.src : null, confirmedBy: r.confirmedBy || null, attempts: r.attempts });
  const att = r.attempts.map((a) => `${a.id}:${a.ok ? 'ok' : a.why}`).join(', ');
  log(`Canlı ${key}: ${isUsable(r.datum) ? `${r.datum.v} (${r.datum.src})` : `YOK — ${r.datum.why}`} [${att}]`);
}

for (const a of ASSETS) {
  if (a.kind === 'metal') await fetchLive(a.symbol, metalProviders(a.symbol), lastClose(`${a.symbol}USD`), JUMP.metal);
  else await fetchLive(a.symbol, cryptoProviders(a.symbol), lastClose(`${a.symbol}USD`), JUMP.crypto);
}
await fetchLive('USDTRY', usdTryProviders(), lastClose('USDTRY'), JUMP.fx);

// 3) Metal kapanış kaydı: New York 17:00–18:00 arasındaki günlük arada fiyat sabittir;
//    bu aradaki çalıştırma o günün kapanışını kendi kaydımız olarak saklar.
const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now));
const nyWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
if (nyHour === 17 && !['Sat', 'Sun'].includes(nyWeekday)) {
  for (const a of ASSETS.filter((x) => x.kind === 'metal')) {
    const d = live[a.symbol];
    const id = `${a.symbol}USD`;
    if (isUsable(d) && d.st === 'ok') {
      const day = tradingDate('metal', now - 2 * 3600e3); // aradaki fiyat o günün kapanışıdır
      histories[id].snapshots = merge(histories[id].snapshots || [], [[day, d.v]]);
      historyChanged = true;
      log(`Kapanış kaydı ${id} ${day}: ${d.v}`);
    }
  }
}

// 4) Çıktılar
const series = Object.fromEntries(Object.keys(SERIES).map((id) => [id, combined(histories[id])]));
const market = buildMarket({ now, live, history: series, sources, buildId: BUILD_ID });
analyzeMarket(market, series);
for (const a of ASSETS) {
  const an = market.assets[a.id].analysis;
  const bt = market.assets[a.id].backtest;
  log(`Analiz ${a.id}: ${an.labelText} (puan ${an.total}, güven ${an.confidence?.text || '-'}); geçmiş test alım isabeti ${bt.available ? `${(bt.buy.hit * 100).toFixed(1)}% / taban ${(bt.baseline.up * 100).toFixed(1)}%` : 'yok'}`);
}
await mkdir(join(SITE_DIR, 'data'), { recursive: true });
await writeFile(join(SITE_DIR, 'data', 'market.json'), `${JSON.stringify(market)}\n`);
const historyOut = {
  schemaVersion: 1,
  generatedAt: new Date(now).toISOString(),
  series: Object.fromEntries(
    Object.keys(SERIES).map((id) => [id, { unit: SERIES[id].unit, sources: histories[id].sources || null, points: series[id] }]),
  ),
};
await writeFile(join(SITE_DIR, 'data', 'history.json'), `${JSON.stringify(historyOut)}\n`);

if (historyChanged) {
  for (const id of Object.keys(SERIES)) await saveHistory(VERI_DIR, histories[id]);
}
log(`Tamam. Geçmiş değişti: ${historyChanged ? 'evet' : 'hayır'}. Çıktı: ${SITE_DIR}/data`);
