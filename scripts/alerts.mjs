// Bildirim görevi (gizli depoda, 30 dakikada bir GitHub Actions ile çalışır).
// 1) Gizli depodaki portfoy.json ve bildirim-durumu.json okunur
// 2) Güncel fiyatlar yedekli kaynaklardan alınır; trend olayları yayındaki market.json'dan okunur
// 3) Kâr hedefi, zarar sınırı ve trend bozulması için Telegram mesajı gönderilir (tekrarsız)
// 4) Durum dosyası güncellenir (iş akışı bunu gizli depoya kaydeder)
//
// Kayıtlara (log) tutar, miktar ya da sohbet numarası yazılmaz.
//
// Ortam değişkenleri:
//   DATA_DIR            gizli deponun klasörü (varsayılan: .)
//   TELEGRAM_BOT_TOKEN  GitHub Secret
//   TELEGRAM_CHAT_ID    isteğe bağlı; yoksa telegram.json'dan okunur
//   MARKET_URL          yayındaki market.json adresi
//   DENEME              "true" ise gerçek portföy yerine deneme pozisyonuyla uyarı denenir

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSETS } from '../site/js/core/assets.js';
import { isUsable } from '../site/js/core/datum.js';
import { buildMarket } from '../site/js/core/market.js';
import { emptyPortfolio, validatePortfolioFile, PORTFOLIO_SCHEMA } from '../site/js/core/portfolio.js';
import { planAlerts, nextAlertState, shouldSaveState, emptyAlertState, priceFreshness, istanbulDay, ALERT_STATE_SCHEMA } from '../site/js/core/alerts.js';
import { decFromNumber } from '../site/js/core/money.js';
import { PORTFOLIO_PATH, ALERT_STATE_PATH } from '../site/js/core/sync.js';
import { httpGetJson } from './lib/http.mjs';
import { fetchLivePrices } from './lib/live.mjs';
import { telegramClient } from './lib/telegram.mjs';

const DATA_DIR = process.env.DATA_DIR || '.';
const MARKET_URL = process.env.MARKET_URL || 'https://emrekalpakci.github.io/deneme/data/market.json';
const DEMO = process.env.DENEME === 'true';
const EVENTS_MAX_AGE_MS = 36 * 3600 * 1000;
const now = Date.now();
const log = (...a) => console.log(...a);

async function readJson(name) {
  try {
    return { data: JSON.parse(await readFile(join(DATA_DIR, name), 'utf8')) };
  } catch (err) {
    return { data: null, missing: err.code === 'ENOENT', error: err.code === 'ENOENT' ? null : 'okunamadı' };
  }
}

// --- Telegram ayarı -------------------------------------------------------------
const tg = await readJson('telegram.json');
const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim() || tg.data?.chatId;
if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) {
  log('::warning::Telegram henüz kurulmadı (bot anahtarı ya da sohbet bilgisi yok). Kurulum adımları: docs/KURULUM.md');
  process.exit(0);
}
const bot = telegramClient(process.env.TELEGRAM_BOT_TOKEN);

// --- Durum ve portföy ---------------------------------------------------------------
const stateFile = await readJson(ALERT_STATE_PATH);
const state = stateFile.data?.schemaVersion === ALERT_STATE_SCHEMA ? stateFile.data : emptyAlertState();

const pf = await readJson(PORTFOLIO_PATH);
let portfolio = emptyPortfolio();
let portfolioProblem = null;
if (pf.data) {
  if (pf.data.schemaVersion !== PORTFOLIO_SCHEMA || !Array.isArray(pf.data.tx)) {
    portfolioProblem = 'Portföy dosyasının sürümü ya da biçimi uyumsuz';
  } else {
    portfolio = pf.data; // tek tük hatalı işlem varsa hesaplama onları zaten dışarıda bırakır
    const errs = validatePortfolioFile(pf.data);
    if (errs.length) log(`Uyarı: portföy dosyasında ${errs.length} sorun var (ayrıntı uygulamada görünür).`);
  }
} else if (pf.error) {
  portfolioProblem = 'Portföy dosyası okunamadı (bozuk JSON)';
}

// --- Piyasa verisi ------------------------------------------------------------------------
const pub = await httpGetJson(MARKET_URL, { retries: 1, timeoutMs: 15000 });
const published = pub.ok ? pub.data : null;
log(`Yayındaki veri: ${published ? `alındı (${published.generatedAt})` : `alınamadı (${pub.error})`}`);
const eventsFresh = published && now - new Date(published.generatedAt).getTime() <= EVENTS_MAX_AGE_MS;
const events = eventsFresh ? Object.fromEntries(ASSETS.map((a) => [a.id, published.assets?.[a.id]?.analysis?.events || []])) : {};

const refOf = (a) => {
  const m = published?.assets?.[a.id];
  const d = a.kind === 'metal' ? m?.ounceUsd : m?.usd;
  return isUsable(d) ? d.v : undefined;
};
const refs = Object.fromEntries([...ASSETS.map((a) => [a.symbol, refOf(a)]), ['USDTRY', isUsable(published?.fx?.USDTRY) ? published.fx.USDTRY.v : undefined]]);
const { live, sources } = await fetchLivePrices(refs, { deadlineMs: 50_000 });
log(`Canlı fiyatlar: ${sources.map((s) => `${s.key}:${s.used || 'YOK'}`).join(', ')}`);
const market = buildMarket({ now, live, history: {}, sources });

// --- Uyarılar ----------------------------------------------------------------------------
async function sendAll(messages) {
  const sent = [];
  const errors = [];
  for (const m of messages) {
    const r = await bot.send(chatId, m.text);
    sent.push(r.ok);
    if (!r.ok) errors.push(r);
  }
  return { sent, errors };
}

let next;
let failures = [];
if (DEMO) {
  // Deneme: gerçek portföye dokunmadan, fiyatı %40 artmış gibi görünen 1 birimlik pozisyon.
  const asset = ASSETS.find((a) => priceFreshness(market, a, now).fresh);
  const demoState = state.demo || emptyAlertState();
  if (!asset) {
    log('Deneme yapılamadı: hiçbir varlık için güncel fiyat yok.');
    const r = await bot.send(chatId, '🧪 DENEME — Şu an hiçbir varlık için güncel fiyat alınamadı; deneme uyarısı oluşturulamadı. Birazdan yeniden dene.');
    failures = r.ok ? [] : [r];
    next = { ...state };
  } else {
    const price = market.assets[asset.id].try.v;
    const cost = decFromNumber(price).div('1.4').round(2).toFixed(2);
    const demoPortfolio = {
      ...emptyPortfolio(),
      tx: [{ id: 'deneme-1', type: 'buy', asset: asset.id, date: istanbulDay(now), qty: '1', amountTry: cost, feeTry: '0', createdAt: new Date(now).toISOString() }],
    };
    const plan = planAlerts({ portfolio: demoPortfolio, market, events: {}, state: demoState, now, prefix: '🧪 DENEME — ', heartbeat: false });
    if (plan.messages.length) {
      const { sent, errors } = await sendAll(plan.messages);
      failures = errors;
      next = { ...state, demo: nextAlertState({ state: demoState, plan, sent, now, result: 'deneme' }) };
      log(`Deneme: ${sent.filter(Boolean).length}/${plan.messages.length} mesaj gönderildi.`);
    } else {
      const r = await bot.send(chatId, '🧪 DENEME — Aynı uyarı ikinci kez gönderilmedi: tekrar önleme çalışıyor. (Deneme kaydı sıfırlandı; bir sonraki denemede uyarı yeniden gelir.)');
      failures = r.ok ? [] : [r];
      next = { ...state, demo: undefined };
      log('Deneme: uyarı zaten gönderilmişti; tekrar gönderilmedi.');
    }
  }
} else {
  const plan = planAlerts({ portfolio, market, events, state, now });
  if (portfolioProblem && state.lastStaleNotice !== istanbulDay(now)) {
    plan.messages.push({ keys: [], asset: null, kind: 'stale', title: 'Portföy okunamadı', text: `ℹ️ ${portfolioProblem}. Uygulamada Ayarlar → Portföy eşitleme bölümünden "Şimdi eşitle"ye bas. Bu mesaj günde en fazla bir kez gelir.` });
  }
  const { sent, errors } = await sendAll(plan.messages);
  failures = errors;
  const result = portfolioProblem ? 'portföy okunamadı' : plan.stale.length ? 'bazı fiyatlar alınamadı' : 'tamam';
  next = nextAlertState({ state, plan, sent, now, result });
  log(`Açık pozisyon: ${plan.openCount}; fiyatı güncel olmayan: ${plan.stale.length}; mesaj: ${sent.filter(Boolean).length}/${plan.messages.length} gönderildi (${plan.messages.map((m) => m.kind).join(', ') || '-'}).`);
}

for (const f of failures) log(`::warning::Mesaj gönderilemedi: ${f.error}`);
if (next.demo === undefined) delete next.demo;
if (shouldSaveState(stateFile.data, next, now)) {
  next.lastSavedAt = new Date(now).toISOString();
  await writeFile(join(DATA_DIR, ALERT_STATE_PATH), `${JSON.stringify(next, null, 2)}\n`);
  log('Durum dosyası güncellendi.');
}

// Ayar hatası (yanlış anahtar, engellenmiş bot) varsa görev kırmızı görünsün; GitHub e-postayla haber verir.
if (failures.some((f) => [400, 401, 403].includes(f.status))) process.exit(1);
process.exit(0); // bitmemiş ağ isteklerini beklemeden çık (görev süresi kısa kalsın)
