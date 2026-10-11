// Bütçe planlayıcı ekranı: bütçe, vade ve risk → "şu kadar TL ile şunu al", gerekçe, senaryolar, aylık plan.

import { h } from '../dom.js';
import { formatDay } from '../format.js';
import { Big, parseTrNumber, formatTry, formatPercent, formatQuantity, decFromNumber, formatDecimal } from '../../core/money.js';
import { getAsset } from '../../core/assets.js';
import { isUsable } from '../../core/datum.js';
import {
  CASH,
  PLAN_ASSETS,
  LIMITS,
  BASE,
  targetWeights,
  tiltLabel,
  allocate,
  monthlyPlan,
  REASONS,
  cashReason,
  horizonNote,
  assetName,
} from '../../core/budget.js';
import { WEEKS, tryDailySeries, fxDailySeries, alignWeekly, lumpSumScenarios, monthlyBuyScenarios, toUsdAligned } from '../../core/scenarios.js';

const DISCLAIMER = 'Bu bilgilendirmedir, yatırım tavsiyesi değildir.';

const ui = {
  budget: '',
  horizon: 'long',
  risk: 'medium',
  emergencyOk: false,
  monthly: false,
  months: 12,
  submitted: null, // { budget: '50000', horizon, risk, months, monthly }
  errors: [],
  scenarioCache: new Map(),
};

export function renderBudget(ctx) {
  const parts = [formCard(ctx)];
  if (ui.submitted) {
    const cards = resultCards(ctx, ui.submitted);
    parts.push(...cards);
    if (ui.scrollToResult) {
      ui.scrollToResult = false;
      setTimeout(() => cards[0].scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }
  parts.push(h('p', { class: 'disclaimer' }, DISCLAIMER));
  return h('div', {}, parts);
}

// --- Form -------------------------------------------------------------------------------

function seg(key, options, rerender) {
  return h(
    'div',
    { class: 'segmented', role: 'group' },
    options.map(([val, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(ui[key] === val), onclick: () => ((ui[key] = val), rerender()) }, label),
    ),
  );
}

function formCard(ctx) {
  const rerender = ctx.rerender;
  const parsed = parseTrNumber(ui.budget, 'amount');
  const hint = h('span', { class: 'meta' }, parsed.ok ? `Algılanan: ${formatTry(parsed.value)}` : 'Ör. 50.000');
  const submit = () => {
    ui.errors = [];
    const p = parseTrNumber(ui.budget, 'amount');
    if (!p.ok) ui.errors.push(`Bütçe: ${p.error}`);
    else if (new Big(p.value).lt('100')) ui.errors.push('Bütçe en az 100 TL olmalı.');
    if (!ui.emergencyOk) ui.errors.push('Devam etmeden önce acil durum notunu okuyup kutuyu işaretle.');
    ui.submitted = ui.errors.length ? null : { budget: p.value, horizon: ui.horizon, risk: ui.risk, monthly: ui.horizon === 'long' && ui.monthly, months: ui.months };
    ui.scrollToResult = !!ui.submitted;
    rerender();
  };
  return h(
    'section',
    { class: 'card form', 'aria-label': 'Bütçe bilgileri' },
    h('h2', {}, 'Bütçe planlayıcı'),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Yatırmak istediğin tutar (TL)'),
      h('input', {
        type: 'text',
        inputmode: 'decimal',
        value: ui.budget,
        autocomplete: 'off',
        oninput: (e) => {
          ui.budget = e.target.value;
          const r = parseTrNumber(ui.budget, 'amount');
          hint.textContent = r.ok ? `Algılanan: ${formatTry(r.value)}` : 'Ör. 50.000';
        },
      }),
      hint,
    ),
    h('span', { class: 'field-label' }, 'Vade (parayı ne kadar süre bırakabilirsin?)'),
    seg(
      'horizon',
      [
        ['short', 'Kısa (0–6 ay)'],
        ['long', 'Uzun (1 yıl ve üzeri)'],
      ],
      rerender,
    ),
    h('p', { class: 'meta' }, '6–12 ay arası için daha temkinli olan "Kısa" seçeneğini öneririz.'),
    h('span', { class: 'field-label' }, 'Risk tercihi (düşüşlere ne kadar dayanabilirsin?)'),
    seg(
      'risk',
      [
        ['low', 'Düşük'],
        ['medium', 'Orta'],
        ['high', 'Yüksek'],
      ],
      rerender,
    ),
    ui.horizon === 'long'
      ? h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', checked: ui.monthly, onchange: (e) => ((ui.monthly = e.target.checked), rerender()) }),
          h('span', {}, 'Tek seferde değil, aylık parçalı alım planı istiyorum'),
        )
      : null,
    ui.horizon === 'long' && ui.monthly
      ? seg(
          'months',
          [
            [6, '6 ay'],
            [12, '12 ay'],
            [24, '24 ay'],
          ],
          rerender,
        )
      : null,
    h(
      'div',
      { class: 'note warn' },
      h('strong', {}, 'Önce acil durum fonu: '),
      'Kira, fatura gibi 3–6 aylık zorunlu giderini yatırıma ayırma; ayrı ve kolay çekilebilir bir yerde tut. Ani bir ihtiyaçta düşmüş bir yatırımı zararına satmak zorunda kalabilirsin.',
    ),
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: ui.emergencyOk, onchange: (e) => (ui.emergencyOk = e.target.checked) }),
      h('span', {}, 'Bu para acil durum birikimim değil; onu ayrıca ayırdım.'),
    ),
    ui.errors.map((e) => h('p', { class: 'unavailable' }, e)),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, 'Planı göster'),
  );
}

// --- Sonuç ------------------------------------------------------------------------------

const RISK_TR = { low: 'düşük', medium: 'orta', high: 'yüksek' };

const BASE_PCT = (s, a) => BASE[s.horizon][s.risk][a];

function tiltText(asset, label, analysis) {
  const name = getAsset(asset).name;
  if (analysis?.label === 'buy' && label === 'wait') return `${name} "Alım için uygun" görünüyor ama güven düşük olduğu için payı artırılmadı.`;
  if (label === 'buy') return `${name} "Alım için uygun" göründüğü için payı biraz artırıldı.`;
  if (label === 'expensive') return `${name} "Pahalı görünüyor" olduğu için payı azaltıldı.`;
  if (label === 'none') return `${name} için güncel analiz yapılamadığından (veri yetersiz) plana alınmadı.`;
  return null;
}

/** Tam sayı tutarlarda kuruş gösterilmez: "27.500 TL". */
function tryShort(x) {
  return x.round(0).eq(x) ? `${formatDecimal(x, 0)} TL` : formatTry(x);
}

function resultCards(ctx, s) {
  const prices = Object.fromEntries(PLAN_ASSETS.map((a) => [a, ctx.market?.assets?.[a]?.try]));
  const available = Object.fromEntries(PLAN_ASSETS.map((a) => [a, isUsable(prices[a])]));
  const analyses = Object.fromEntries(PLAN_ASSETS.map((a) => [a, ctx.market?.assets?.[a]?.analysis]));
  const labels = Object.fromEntries(PLAN_ASSETS.map((a) => [a, tiltLabel(analyses[a])]));
  const { weights, notes } = targetWeights({ horizon: s.horizon, risk: s.risk, available, labels });
  const tiltNotes = PLAN_ASSETS.filter((a) => available[a] && BASE_PCT(s, a) > 0)
    .map((a) => tiltText(a, labels[a], analyses[a]))
    .filter(Boolean);
  const alloc = allocate(s.budget, weights);
  const B = alloc.budget;

  const rows = alloc.parts.map((p) => {
    const a = getAsset(p.asset);
    const price = prices[p.asset];
    const qty = isUsable(price) ? p.amount.div(new Big(String(price.v))) : null;
    return h(
      'li',
      { class: 'alloc' },
      h(
        'div',
        { class: 'alloc-head' },
        h('strong', {}, `${tryShort(p.amount)} ile ${a.name} al`),
        h('span', { class: 'pill' }, formatPercent(p.amount.div(B).times('100').round(1), 1)),
      ),
      qty ? h('div', { class: 'meta' }, `Bugünkü fiyatla yaklaşık ${formatQuantity(qty.round(a.kind === 'metal' ? 2 : 6), a.kind === 'metal' ? 2 : 6, a.unitLabel)}`) : null,
      h('div', { class: 'reason' }, REASONS[p.asset]),
    );
  });
  rows.push(
    h(
      'li',
      { class: 'alloc' },
      h(
        'div',
        { class: 'alloc-head' },
        h('strong', {}, `${tryShort(alloc.cash)} nakitte beklesin`),
        h('span', { class: 'pill' }, formatPercent(alloc.cash.div(B).times('100').round(1), 1)),
      ),
      h('div', { class: 'reason' }, cashReason(s.horizon)),
    ),
  );

  const cards = [
    h(
      'section',
      { class: 'card', 'aria-label': 'Önerilen dağılım' },
      h('h2', {}, `${tryShort(B)} için öneri`),
      h('p', { class: 'meta' }, `Vade: ${s.horizon === 'short' ? 'kısa (0–6 ay)' : 'uzun (1 yıl+)'} · Risk: ${RISK_TR[s.risk]}`),
      h('ul', { class: 'list alloc-list' }, rows),
      notes.map((n) => h('p', { class: 'unavailable' }, `${getAsset(n.asset).name}: ${n.text}`)),
      h(
        'div',
        { class: 'note' },
        h('div', {}, `• ${horizonNote(s.horizon)}`),
        h('div', {}, `• Tek varlığa en fazla %${LIMITS.singleAssetMax}, kriptoya toplam en fazla %${LIMITS.cryptoMax} ayrılır; tüm bütçe tek yere konmaz.`),
        weights.btc + weights.eth > 0 ? h('div', {}, '• Kripto paralar çok sert düşebilir. Kaybetmeyi göze alamayacağın parayı kriptoya koyma.') : null,
        h('div', {}, '• Tutarlar kolay alım için yuvarlandı; küçük artıklar nakitte bırakıldı.'),
        h('div', {}, '• Alım-satım farkı (makas) ve komisyon nedeniyle aldığın miktar biraz farklı olabilir.'),
      ),
      tiltNotes.length
        ? h('div', { class: 'note' }, h('strong', {}, 'Güncel duruma göre ayar: '), tiltNotes.join(' '))
        : h('p', { class: 'meta' }, 'Güncel analizde payları değiştiren bir durum yok (hepsi "Bekle").'),
    ),
  ];

  if (s.monthly) cards.push(monthlyCard(alloc, s.months));
  cards.push(scenarioCard(ctx, s, alloc));
  return cards;
}

function monthlyCard(alloc, months) {
  const rows = monthlyPlan(alloc.parts, months);
  const today = new Date();
  const monthName = (i) =>
    new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' }).format(new Date(today.getFullYear(), today.getMonth() + i, 15));
  const first = rows[0];
  const last = rows[rows.length - 1];
  return h(
    'section',
    { class: 'card', 'aria-label': 'Aylık alım planı' },
    h('h2', {}, `${months} aylık parçalı alım planı`),
    h('p', { class: 'meta' }, 'Her ay aynı tutarla alım yapılır. Böylece tek bir günün fiyatına bağlı kalmazsın (ortalama maliyet etkisi).'),
    h(
      'ul',
      { class: 'list' },
      alloc.parts.map((p) => h('li', {}, h('span', { class: 'label' }, `${getAsset(p.asset).name} / ay`), h('span', {}, formatTry(first.amounts[p.asset])))),
      h('li', {}, h('strong', {}, 'Her ay toplam'), h('strong', {}, formatTry(first.total))),
    ),
    last.total.eq(first.total) ? null : h('p', { class: 'meta' }, `Son ay (${monthName(months - 1)}) kuruş farkları nedeniyle toplam ${formatTry(last.total)}.`),
    h('p', { class: 'meta' }, `Plan: ${monthName(0)} – ${monthName(months - 1)}. Nakit payı (${formatTry(alloc.cash)}) baştan kenarda kalır.`),
  );
}

// --- Senaryolar --------------------------------------------------------------------------

function scenarioCard(ctx, s, alloc) {
  const card = h('section', { class: 'card', 'aria-label': 'Senaryolar' }, h('h2', {}, 'Ne olabilir? (geçmişe göre)'));
  const weights = Object.fromEntries(alloc.parts.map((p) => [p.asset, Number(p.amount.div(alloc.budget).toFixed(10))]));
  const key = JSON.stringify({ weights, h: s.horizon, m: s.monthly ? s.months : 0 });
  const cached = ui.scenarioCache.get(key);
  if (!cached) {
    card.appendChild(h('p', { class: 'meta' }, 'Geçmiş veriler yükleniyor…'));
    ctx
      .loadHistory()
      .then((hist) => ui.scenarioCache.set(key, computeScenarios(hist, weights, s)))
      .catch(() => ui.scenarioCache.set(key, { error: 'Geçmiş veriler yüklenemedi; senaryo gösterilemiyor.' }))
      .finally(() => ctx.rerender());
    return card;
  }
  if (cached.error) {
    card.appendChild(h('p', { class: 'unavailable' }, cached.error));
    return card;
  }
  const { tl, usd, bench, label } = cached;
  if (!tl.available) {
    card.appendChild(h('p', { class: 'unavailable' }, tl.why));
    return card;
  }
  const B = alloc.budget;
  const result = (r) => formatTry(B.times(decFromNumber(1 + r)).round(0));
  const pct = (r) => formatPercent(decFromNumber(r * 100).round(1), 1, { signed: true });
  card.append(
    h('p', { class: 'meta' }, `${label}. ${formatDay(tl.from)} – ${formatDay(tl.to)} arasındaki ${tl.windows} dönemin sonuçları (TL; dönemler haftalık kaydırıldığı için birbiriyle örtüşür):`),
    h(
      'ul',
      { class: 'list' },
      h('li', {}, h('span', { class: 'label' }, 'Kötü (en kötü %10)'), h('span', { class: tl.bad < 0 ? 'down' : '' }, `${result(tl.bad)} (${pct(tl.bad)})`)),
      h('li', {}, h('span', { class: 'label' }, 'Orta (ortanca)'), h('span', {}, `${result(tl.mid)} (${pct(tl.mid)})`)),
      h('li', {}, h('span', { class: 'label' }, 'İyi (en iyi %10)'), h('span', { class: 'up' }, `${result(tl.good)} (${pct(tl.good)})`)),
    ),
    h('p', {}, `Zararla biten dönemlerin oranı: ${formatPercent(decFromNumber(tl.lossShare * 100).round(1), 1)}. En kötü dönem: ${pct(tl.worst)}.`),
    h(
      'div',
      { class: 'note warn' },
      h('strong', {}, 'Dikkat: '),
      `Bu TL getirilerin büyük kısmı TL'nin değer kaybından gelir. Aynı tutarı (nakit hariç) aynı dönemlerde sadece dolarda tutmak ortancada ${pct(bench.mid)} getirirdi. `,
      `Aynı plan dolar bazında ölçülünce ortanca sonuç ${pct(usd.mid)}, kötü senaryo ${pct(usd.bad)}. `,
      'Enflasyon hesaba katılmadı; paranın alım gücü bu kadar artmamış olabilir. Nakit kısmı %0 getiriyle hesaplandı.',
    ),
    h('p', { class: 'meta' }, 'Geçmiş, geleceği garanti etmez. Bu rakamlar olasılık fikri vermek içindir, vaat değildir.'),
  );
  return card;
}

/** Senaryoları hesaplar: TL, dolar bazında ve "sadece dolar tutmak" karşılaştırması. */
export function computeScenarios(hist, weights, s) {
  const ids = Object.keys(weights).filter((a) => weights[a] > 0);
  if (!ids.length) return { tl: { available: false, why: 'Planda yatırım payı yok; tüm tutar nakitte.' } };
  const series = Object.fromEntries(ids.map((a) => [a, tryDailySeries(a, hist)]));
  series.USDTRY = fxDailySeries(hist);
  const aligned = alignWeekly(series);
  const usdAligned = toUsdAligned(aligned);
  if (s.monthly) {
    return {
      label: `Her ay eşit alımla ${s.months} ay sürdürülseydi, plan sonunda`,
      tl: monthlyBuyScenarios(weights, aligned, s.months),
      usd: monthlyBuyScenarios(weights, usdAligned, s.months),
      bench: monthlyBuyScenarios({ USDTRY: invested(weights) }, aligned, s.months),
    };
  }
  const span = WEEKS[s.horizon];
  return {
    label: `Bu dağılım ${s.horizon === 'short' ? '6 ay' : '1 yıl'} tutulsaydı`,
    tl: lumpSumScenarios(weights, aligned, span),
    usd: lumpSumScenarios(weights, usdAligned, span),
    bench: lumpSumScenarios({ USDTRY: invested(weights) }, aligned, span),
  };
}

/** Nakit dışındaki pay: karşılaştırmada aynı tutar dolarda tutulmuş sayılır. */
const invested = (weights) => Object.values(weights).reduce((x, y) => x + y, 0);
