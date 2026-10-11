// Analiz parçaları: etiket kutusu, "Puan nasıl oluştu?" tablosu ve geçmiş test özeti.

import { h } from '../dom.js';
import { formatUsd, formatPercent, formatDecimal, decFromNumber } from '../../core/money.js';
import { RULES, LABELS } from '../../core/scoring.js';
import { isDollar, priceDecimals } from '../../core/assets.js';

const p1 = (x) => (x === null || x === undefined ? '—' : formatPercent(decFromNumber(x * 100).round(1), 1));
const signed = (x) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x))}`);

const LABEL_CLASS = { buy: 'label-buy', wait: 'label-wait', expensive: 'label-expensive', none: 'label-none' };

function factorValue(id, raw, asset) {
  if (!raw) {
    if (id === 'fx' && isDollar(asset)) return 'Dolar için kullanılmaz (analiz zaten kurun kendisi)';
    return id === 'news' ? 'yeterli haber yok' : 'veri yok';
  }
  const unit = asset.kind === 'metal' ? '/g' : '';
  const dp = priceDecimals(asset);
  // Dolar'ın analiz fiyatı TL'dir (Dolar/TL kuru); diğerleri dolar fiyatıdır.
  const money = (v) => (isDollar(asset) ? `${formatDecimal(String(v.toFixed(dp)), dp)} TL` : formatUsd(String(v.toFixed(dp)), dp));
  switch (id) {
    case 'trend':
      return `Fiyat ${money(raw.price)}${unit} · 50G ${money(raw.ma50)} · 200G ${money(raw.ma200)}`;
    case 'rsi':
      return `RSI ${formatDecimal(String(raw.rsi.toFixed(1)), 1)}`;
    case 'peak':
      return raw.drawdown > -0.0005 ? 'zirvede' : `zirvenin ${p1(-raw.drawdown)} altında`;
    case 'vol':
      return `yıllık ${p1(raw.vol20)} · son 3 yılın %${Math.round(raw.rank * 100)}'lik diliminde`;
    case 'fx':
      return `3 ayda ${raw.change3m >= 0 ? '+' : '−'}${p1(Math.abs(raw.change3m))}`;
    case 'news':
      return `${raw.n} haber`;
    default:
      return '';
  }
}

/** Etiket, güven ve gerekçe kutusu; içinde açılır "Puan nasıl oluştu?" tablosu. */
export function insightBox(asset, m, ctx) {
  const an = m?.analysis;
  if (!an) return h('div', { class: 'insight label-none' }, h('strong', {}, LABELS.none), h('p', { class: 'meta' }, 'Analiz verisi yok.'));
  const conf = an.confidence;
  const box = h(
    'div',
    { class: `insight ${LABEL_CLASS[an.label] || 'label-none'}` },
    h(
      'div',
      { class: 'insight-head' },
      h('strong', { class: 'insight-label' }, an.labelText),
      conf ? h('span', { class: 'pill' }, `Güven: ${conf.text}`) : null,
    ),
    h('p', { class: 'insight-text' }, an.reasons.join(' ')),
    conf?.why?.length ? h('p', { class: 'meta' }, `Güven neden ${conf.text.toLowerCase()}: ${conf.why.join('; ')}.`) : null,
    h('p', { class: 'meta' }, an.riskNote),
    breakdown(asset, m, ctx),
  );
  return box;
}

function breakdown(asset, m, ctx) {
  const an = m.analysis;
  const rows = an.factors.map((f) =>
    h(
      'tr',
      {},
      h('td', {}, h('div', {}, f.name), h('div', { class: 'meta' }, factorValue(f.id, f.raw, asset))),
      h('td', { class: 'num' }, f.score === null ? '—' : signed(f.score)),
      h('td', { class: 'num' }, `%${Math.round(f.weight * 100)}`),
      h('td', { class: 'num' }, f.contribution === null ? '—' : signed(f.contribution)),
    ),
  );
  return h(
    'details',
    { class: 'breakdown' },
    h('summary', {}, 'Puan nasıl oluştu?'),
    h(
      'table',
      { class: 'factor-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Gösterge'), h('th', {}, 'Puan'), h('th', {}, 'Ağırlık'), h('th', {}, 'Katkı'))),
      h('tbody', {}, rows),
      h('tfoot', {}, h('tr', {}, h('th', {}, 'Toplam puan'), h('th', { class: 'num' }, an.total === null ? '—' : signed(an.total)), h('th', {}), h('th', {}))),
    ),
    h(
      'ul',
      { class: 'rules meta' },
      h('li', {}, 'Her gösterge −100 (olumsuz) ile +100 (olumlu) arasında puanlanır. Eksik göstergenin ağırlığı diğerlerine dağıtılır.'),
      h('li', {}, `"${LABELS.expensive}": RSI ve zirve puanlarının ortalaması ${RULES.expensiveMax} veya altı.`),
      h('li', {}, `"${LABELS.buy}": toplam puan +${RULES.buyMin} veya üstü ve trend olumsuz değil.`),
      h('li', {}, `"${LABELS.none}": göstergelerin %${RULES.minWeight * 100}'inden azı hesaplanabildiyse ya da fiyat güncel değilse.`),
      h('li', {}, 'Diğer durumlarda "Bekle". Göstergeler varlığın dolar fiyatıyla hesaplanır; Dolar/TL etkisi ayrı bir göstergedir. Dolar\'ın kendisi için göstergeler Dolar/TL kuruyla hesaplanır.'),
    ),
    backtestMini(an, m.backtest),
    h('p', { class: 'meta' }, h('a', { href: '#/test' }, 'Stratejinin geçmiş veri testinin tamamı ›')),
  );
}

function backtestMini(an, bt) {
  if (!bt?.available) return h('p', { class: 'meta' }, bt?.why || 'Geçmiş test sonucu yok.');
  const s = an.label === 'expensive' ? bt.expensive : bt.buy;
  const lbl = an.label === 'expensive' ? LABELS.expensive : LABELS.buy;
  const what = an.label === 'expensive' ? 'düştü' : 'yükseldi';
  const base = an.label === 'expensive' ? bt.baseline.down : bt.baseline.up;
  if (!s.days) return h('p', { class: 'meta' }, `"${lbl}" sinyali geçmişte hiç verilmemiş.`);
  return h(
    'p',
    { class: 'note' },
    `Geçmiş test: "${lbl}" denen günlerde 90 gün sonra fiyatın ${what === 'yükseldi' ? 'yükselmiş' : 'düşmüş'} olma oranı ${p1(s.hit)} (maliyet dahil). Rastgele günlerde bu oran ${p1(base)}. `,
    `Birbirinden bağımsız örnek sayısı ${s.nInd}. ${s.verdict.text}`,
  );
}

/** Strateji testi ekranındaki varlık kartı. */
export function backtestCard(asset, m) {
  const bt = m?.backtest;
  if (!bt?.available) return h('section', { class: 'card' }, h('h2', {}, asset.name), h('p', { class: 'unavailable' }, bt?.why || 'Sonuç yok.'));
  const sig = (label, s, base, what) =>
    h(
      'div',
      { class: 'bt-block' },
      h('h3', {}, `"${label}" sinyali`),
      s.days
        ? h(
            'ul',
            { class: 'list' },
            li('Verildiği gün sayısı', `${s.days}`),
            li(`90 gün sonra fiyat ${what}`, `${p1(s.hit)} (rastgele günlerde ${p1(base)})`),
            li('Fark', `${s.edgePp >= 0 ? '+' : '−'}${Math.abs(s.edgePp).toFixed(1).replace('.', ',')} puan`),
            li('Bağımsız örnek (≥ 90 gün arayla)', `${s.nInd} · %95 aralık ${p1(s.ciLow)}–${p1(s.ciHigh)}`),
          )
        : h('p', { class: 'meta' }, 'Bu dönemde hiç verilmedi.'),
      s.days ? h('p', { class: `verdict v-${s.verdict.level}` }, s.verdict.text) : null,
    );
  return h(
    'section',
    { class: 'card', 'aria-label': `${asset.name} geçmiş testi` },
    h('h2', {}, asset.name),
    h('p', { class: 'meta' }, `${bt.from} – ${bt.to} · ${bt.days} gün · al-sat maliyeti %${formatDecimal(String(bt.cost * 100), 1, { trimZeros: true })}`),
    sig(LABELS.buy, bt.buy, bt.baseline.up, 'yükseldi'),
    sig(LABELS.expensive, bt.expensive, bt.baseline.down, 'düştü'),
    h(
      'div',
      { class: 'bt-block' },
      h('h3', {}, 'Sinyale göre al-sat ile al-tut'),
      h(
        'ul',
        { class: 'list' },
        li('Sinyale göre al-sat', `${pctSigned(bt.timing.ret)} · en büyük düşüş ${p1(-bt.timing.maxDD)} · ${bt.timing.trades} alım`),
        li('Al ve tut', `${pctSigned(bt.hold.ret)} · en büyük düşüş ${p1(-bt.hold.maxDD)}`),
      ),
      h('p', { class: 'meta' }, '"Alım için uygun" gelince al, "Pahalı görünüyor" ya da güçlü düşüş trendi gelince sat; işlemler ertesi gün kapanışında, maliyet dahil.'),
    ),
  );
}

function pctSigned(x) {
  return `${x >= 0 ? '+' : '−'}${p1(Math.abs(x))}`;
}

function li(label, value) {
  return h('li', {}, h('span', { class: 'label' }, label), h('span', {}, value));
}
