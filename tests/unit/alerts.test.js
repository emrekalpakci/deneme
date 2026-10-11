import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Big } from '../../site/js/core/money.js';
import { okDatum } from '../../site/js/core/datum.js';
import { buildMarket } from '../../site/js/core/market.js';
import { emptyPortfolio } from '../../site/js/core/portfolio.js';
import { planAlerts, nextAlertState, shouldSaveState, emptyAlertState, weekKey, priceFreshness } from '../../site/js/core/alerts.js';
import { ASSETS } from '../../site/js/core/assets.js';

const TUE = Date.parse('2026-10-13T08:00:00Z'); // Salı 11:00 (Türkiye), piyasalar açık
const MIN = 60_000;
const gold = ASSETS.find((a) => a.id === 'gram-altin');

function market(now, { ounce = 4000, fx = 40, btc = 80000, age = 5 * MIN, fxAge = age } = {}) {
  const t = new Date(now - age).toISOString();
  const tf = new Date(now - fxAge).toISOString();
  return buildMarket({
    now,
    history: {},
    live: { XAU: okDatum(ounce, t, 'test'), XAG: okDatum(50, t, 'test'), BTC: okDatum(btc, t, 'test'), ETH: okDatum(3000, t, 'test'), USDTRY: okDatum(fx, tf, 'test') },
  });
}
const gramTry = (m) => new Big(String(m.assets['gram-altin'].try.v));

let seq = 0;
function buy(asset, qty, amountTry, date = '2026-10-01') {
  seq += 1;
  return { id: `t${seq}`, type: 'buy', asset, date, qty, amountTry, feeTry: '0', createdAt: `2026-10-01T00:00:${String(seq).padStart(2, '0')}Z` };
}
/** P/L oranı istenen değerde olacak şekilde 10 g altın alımı. */
function goldPortfolio(m, plRatio) {
  const amount = gramTry(m).times('10').div(plRatio).toFixed(2);
  return { ...emptyPortfolio(), tx: [buy('gram-altin', '10', amount)] };
}
function run(input, sentAll = true) {
  const plan = planAlerts(input);
  const state = nextAlertState({ state: input.state, plan, sent: plan.messages.map(() => sentAll), now: input.now, result: 'tamam' });
  return { plan, state };
}

test('kâr hedefi: ilk çalıştırmada bir kez gönderilir, ikincide tekrar gönderilmez', () => {
  const m = market(TUE);
  const portfolio = goldPortfolio(m, '1.2'); // +%20, hedef %15
  const r1 = run({ portfolio, market: m, now: TUE, state: emptyAlertState() });
  assert.equal(r1.plan.messages.length, 1);
  assert.equal(r1.plan.messages[0].kind, 'tp');
  assert.match(r1.plan.messages[0].text, /Gram Altın: Kâr hedefine ulaşıldı/);
  assert.match(r1.plan.messages[0].text, /Bu bilgilendirmedir, yatırım tavsiyesi değildir\./);
  assert.match(r1.plan.messages[0].text, /Kâr\/zarar: \+%20,00/);
  const r2 = run({ portfolio, market: market(TUE + 30 * MIN), now: TUE + 30 * MIN, state: r1.state });
  assert.equal(r2.plan.messages.length, 0);
  assert.equal(Object.keys(r2.state.active).length, 1, 'kayıt korunur');
});

test('yeniden kurulma: fiyat seviyenin %3 altına inince kayıt silinir, tekrar çıkınca yeniden gönderilir', () => {
  const m = market(TUE);
  const portfolio = goldPortfolio(m, '1.2');
  const r1 = run({ portfolio, market: m, now: TUE, state: emptyAlertState() });
  // Seviye = maliyet × 1,15. Fiyatı seviyenin %2 altına indir: hâlâ bant içinde, kayıt kalır.
  const near = run({ portfolio, market: market(TUE + 30 * MIN, { ounce: (4000 * 1.15 * 0.98) / 1.2 }), now: TUE + 30 * MIN, state: r1.state });
  assert.equal(near.plan.messages.length, 0);
  assert.equal(Object.keys(near.state.active).length, 1);
  // %5 altına inince kayıt silinir.
  const down = run({ portfolio, market: market(TUE + 60 * MIN, { ounce: (4000 * 1.15 * 0.95) / 1.2 }), now: TUE + 60 * MIN, state: near.state });
  assert.equal(down.plan.messages.length, 0);
  assert.equal(Object.keys(down.state.active).length, 0);
  // Yeniden hedefin üstüne çıkınca tekrar gönderilir.
  const up = run({ portfolio, market: market(TUE + 90 * MIN), now: TUE + 90 * MIN, state: down.state });
  assert.equal(up.plan.messages.length, 1);
});

test('gönderilemeyen uyarı kaydedilmez ve sonraki çalıştırmada yeniden denenir', () => {
  const m = market(TUE);
  const portfolio = goldPortfolio(m, '1.2');
  const failed = run({ portfolio, market: m, now: TUE, state: emptyAlertState() }, false);
  assert.equal(Object.keys(failed.state.active).length, 0);
  assert.equal(failed.state.recent.length, 0);
  const retry = run({ portfolio, market: market(TUE + 30 * MIN), now: TUE + 30 * MIN, state: failed.state });
  assert.equal(retry.plan.messages.length, 1);
  assert.equal(Object.keys(retry.state.active).length, 1);
});

test('eski fiyatla uyarı gönderilmez; 3 saat sürerse günde en fazla bir "veri alınamıyor" mesajı', () => {
  const m = market(TUE);
  const portfolio = goldPortfolio(m, '1.2');
  const oldM = market(TUE, { age: 90 * MIN });
  assert.equal(priceFreshness(oldM, gold, TUE).fresh, false);
  const r1 = run({ portfolio, market: oldM, now: TUE, state: emptyAlertState() });
  assert.equal(r1.plan.messages.length, 0);
  assert.equal(r1.plan.stale.length, 1);
  // Kur eskiyse de gönderilmez.
  const fxOld = run({ portfolio, market: market(TUE, { fxAge: 80 * MIN }), now: TUE, state: emptyAlertState() });
  assert.equal(fxOld.plan.messages.length, 0);
  // 3 saat sonra hâlâ eski: bir bilgi mesajı.
  const t3 = TUE + 3 * 60 * MIN;
  const r2 = run({ portfolio, market: market(t3, { age: 4 * 60 * MIN }), now: t3, state: r1.state });
  assert.deepEqual(r2.plan.messages.map((x) => x.kind), ['stale']);
  assert.match(r2.plan.messages[0].text, /Veri alınamıyor/);
  // Aynı gün ikinci kez gelmez.
  const r3 = run({ portfolio, market: market(t3 + 30 * MIN, { age: 5 * 60 * MIN }), now: t3 + 30 * MIN, state: r2.state });
  assert.equal(r3.plan.messages.length, 0);
});

test('piyasa kapalıyken (hafta sonu) son fiyatla değerlendirilir ve bu yazılır', () => {
  const SAT = Date.parse('2026-10-17T10:00:00Z');
  const m = market(SAT, { age: 20 * 60 * MIN });
  const portfolio = goldPortfolio(m, '1.2');
  const r = run({ portfolio, market: m, now: SAT, state: emptyAlertState() });
  assert.equal(r.plan.messages.length, 1);
  assert.match(r.plan.messages[0].text, /piyasa kapalı, son fiyat/);
});

test('yeni alım ortalama maliyeti değiştirir: eski kayıt düşer, yeni seviye yeni uyarıdır', () => {
  const m = market(TUE);
  const p1 = goldPortfolio(m, '1.2');
  const r1 = run({ portfolio: p1, market: m, now: TUE, state: emptyAlertState() });
  const oldKey = Object.keys(r1.state.active)[0];
  // Bugünkü fiyattan 10 g daha alım: ortalama maliyet yükselir, kâr %9'a iner (hedefin altında).
  const p2 = { ...p1, tx: [...p1.tx, buy('gram-altin', '10', gramTry(m).times('10').toFixed(2), '2026-10-13')] };
  const r2 = run({ portfolio: p2, market: market(TUE + 30 * MIN), now: TUE + 30 * MIN, state: r1.state });
  assert.equal(r2.plan.messages.length, 0);
  assert.equal(r2.state.active[oldKey], undefined);
});

test('iki kat hedef tek mesaj; sonra fiyat geri gelse de "kâr hedefi" ayrıca gönderilmez', () => {
  const m = market(TUE);
  const portfolio = goldPortfolio(m, '1.4'); // +%40 ≥ 2 × %15
  const r1 = run({ portfolio, market: m, now: TUE, state: emptyAlertState() });
  assert.deepEqual(r1.plan.messages.map((x) => x.kind), ['tp2']);
  assert.equal(r1.plan.messages[0].keys.length, 2);
  // Fiyat +%20 seviyesine geriler: tp2 kaydı düşer ama tp hâlâ etkin, mesaj yok.
  const r2 = run({ portfolio, market: market(TUE + 30 * MIN, { ounce: (4000 * 1.2) / 1.4 }), now: TUE + 30 * MIN, state: r1.state });
  assert.equal(r2.plan.messages.length, 0);
  assert.equal(Object.keys(r2.state.active).length, 1);
});

test('zarar sınırı ve trend bozulması; trend olayı bir kez gönderilir', () => {
  const m = market(TUE);
  const portfolio = goldPortfolio(m, '0.9'); // −%10, sınır %8
  const events = { 'gram-altin': [{ type: 'below200', date: '2026-10-12' }, { type: 'goldenCross', date: '2026-10-12' }] };
  const r1 = run({ portfolio, market: m, events, now: TUE, state: emptyAlertState() });
  assert.deepEqual(r1.plan.messages.map((x) => x.kind).sort(), ['sl', 'trend']);
  assert.match(r1.plan.messages.find((x) => x.kind === 'trend').text, /200 günlük ortalamanın altına/);
  assert.match(r1.plan.messages.find((x) => x.kind === 'sl').text, /Zarar sınırın: −%8/);
  const r2 = run({ portfolio, market: market(TUE + 30 * MIN), events, now: TUE + 30 * MIN, state: r1.state });
  assert.equal(r2.plan.messages.length, 0);
});

test('boş portföyde uyarı yok; haftalık özet Pazartesi bir kez, kapatılabilir', () => {
  const MON = Date.parse('2026-10-12T07:30:00Z'); // Pazartesi 10:30 (Türkiye)
  const m = market(MON);
  const r0 = run({ portfolio: emptyPortfolio(), market: market(TUE), now: TUE, state: emptyAlertState() });
  assert.equal(r0.plan.messages.length, 0);
  const r1 = run({ portfolio: emptyPortfolio(), market: m, now: MON, state: emptyAlertState() });
  assert.deepEqual(r1.plan.messages.map((x) => x.kind), ['heartbeat']);
  assert.match(r1.plan.messages[0].text, /bildirim sistemi çalışıyor/);
  assert.equal(r1.state.lastHeartbeat, weekKey(MON));
  const r2 = run({ portfolio: emptyPortfolio(), market: m, now: MON + 30 * MIN, state: r1.state });
  assert.equal(r2.plan.messages.length, 0);
  const off = { ...emptyPortfolio(), settings: { targets: {}, alerts: { weekly: false } } };
  assert.equal(run({ portfolio: off, market: m, now: MON, state: emptyAlertState() }).plan.messages.length, 0);
  // Değerli portföyde özet toplam değeri içerir.
  const r3 = run({ portfolio: goldPortfolio(m, '1.05'), market: m, now: MON, state: emptyAlertState() });
  assert.match(r3.plan.messages.find((x) => x.kind === 'heartbeat').text, /Portföy değeri: /);
});

test('silinmiş işlem hesaba katılmaz; kullanıcının hedefi kullanılır', () => {
  const m = market(TUE);
  const p = goldPortfolio(m, '1.2');
  p.tx[0].deleted = true;
  assert.equal(run({ portfolio: p, market: m, now: TUE, state: emptyAlertState() }).plan.messages.length, 0);
  const q = goldPortfolio(m, '1.2');
  q.settings.targets['gram-altin'] = { tp: '25', sl: '8' };
  assert.equal(run({ portfolio: q, market: m, now: TUE, state: emptyAlertState() }).plan.messages.length, 0);
});

test('durum dosyası: önemli değişiklikte hemen, yoksa 3 saatte bir yazılır', () => {
  const s0 = { ...emptyAlertState(), lastRunAt: '2026-10-13T08:00:00Z', lastSavedAt: '2026-10-13T08:00:00Z', lastResult: 'tamam' };
  const same = { ...s0, lastRunAt: '2026-10-13T08:30:00Z' };
  assert.equal(shouldSaveState(s0, same, Date.parse('2026-10-13T08:30:00Z')), false);
  assert.equal(shouldSaveState(s0, same, Date.parse('2026-10-13T11:01:00Z')), true);
  assert.equal(shouldSaveState(s0, { ...same, active: { x: { sentAt: 'y' } } }, Date.parse('2026-10-13T08:30:00Z')), true);
  assert.equal(shouldSaveState(null, same, Date.parse('2026-10-13T08:30:00Z')), true);
});
