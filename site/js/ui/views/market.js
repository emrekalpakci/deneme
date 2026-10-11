// Piyasa (ana ekran): her varlık için büyük TL fiyatı, USD fiyatı, değişim, grafik, saat ve kaynak.

import { h } from '../dom.js';
import { sparkline } from '../chart.js';
import { formatWhen, formatAge, formatDay } from '../format.js';
import { formatTry, formatUsd, formatPercent, formatDecimal } from '../../core/money.js';
import { ASSETS, METAL_NOTE } from '../../core/assets.js';
import { isUsable } from '../../core/datum.js';
import { insightBox } from './insight.js';

const DISCLAIMER = 'Bu bilgilendirmedir, yatırım tavsiyesi değildir.';
const LIVE_PILL_MAX_AGE_MS = 3 * 60 * 1000;

export function renderMarket(state) {
  const { market, now } = state;
  if (!market) return renderNoData(state);
  const fx = market.fx?.USDTRY;
  return h(
    'div',
    {},
    h(
      'p',
      { class: 'meta updated-line' },
      `Otomatik güncelleme: ${formatWhen(market.generatedAt, now)} (${formatAge(market.generatedAt, now)}). `,
      'Veriler 30 dakikada bir yenilenir; uygulama açıkken ons ve kripto fiyatları dakikada bir yenilenir. Analiz, otomatik güncellemedeki fiyatla yapılır.',
    ),
    fxCard(fx, now),
    ASSETS.map((a) => assetCard(a, market.assets?.[a.id], fx, now)),
    h('p', { class: 'disclaimer' }, DISCLAIMER),
  );
}

function renderNoData(state) {
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Veriler yüklenemedi'),
    h('p', {}, state.error ? `Neden: ${state.error}.` : 'Veri dosyası bulunamadı.'),
    h('p', { class: 'meta' }, 'Uydurma fiyat gösterilmez. İnternet bağlantını kontrol edip tekrar dene.'),
    h('button', { class: 'btn btn-primary', onclick: () => state.reload() }, 'Tekrar dene'),
  );
}

function statusPill(datum, { marketOpen, live, now }) {
  if (!isUsable(datum)) return h('span', { class: 'pill' }, 'Veri yok');
  if (live && now - new Date(live.at).getTime() < LIVE_PILL_MAX_AGE_MS) return h('span', { class: 'pill live' }, 'Canlı');
  if (marketOpen === false) return h('span', { class: 'pill closed' }, 'Piyasa kapalı');
  if (datum.st === 'stale') return h('span', { class: 'pill stale' }, 'Güncel değil');
  return h('span', { class: 'pill' }, `${formatWhen(datum.asOf, now)} itibarıyla`);
}

function changeLine(pct, label) {
  if (pct === null || pct === undefined) return h('div', { class: 'meta' }, 'Önceki kapanış verisi yok; değişim hesaplanamadı.');
  const cls = pct > 0 ? 'change up' : pct < 0 ? 'change down' : 'change';
  const word = pct > 0 ? 'yükseliş' : pct < 0 ? 'düşüş' : 'değişim yok';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
  return h('div', {}, h('span', { class: cls }, `${arrow} ${formatPercent(String(pct), 2, { signed: true })} ${word}`), h('span', { class: 'meta' }, ` · ${label}`));
}

function sourceLine(label, datum, now, marketOpen = true) {
  if (!isUsable(datum)) return h('div', {}, `${label}: alınamadı (${datum?.why || 'bilinmeyen neden'})`);
  // Piyasa kapalıyken bazı kaynaklar "şimdiki" saati yazar; yanıltmamak için saat yerine "son işlem" denir.
  if (marketOpen === false) return h('div', {}, `${label}: piyasa kapalı, son işlem fiyatı · ${datum.src}`);
  const stale = datum.st === 'stale' ? ' · güncel değil' : '';
  return h('div', {}, `${label}: ${formatWhen(datum.asOf, now)} · ${datum.src}${stale}`);
}

function fxCard(fx, now) {
  const usable = isUsable(fx);
  return h(
    'section',
    { class: 'card', 'aria-label': 'Dolar/TL' },
    h('div', { class: 'asset-head' }, h('h2', {}, 'Dolar/TL'), statusPill(fx, { marketOpen: fx?.marketOpen, now })),
    usable
      ? h('div', { class: 'price-main small' }, `${formatDecimal(fx.v, 4)} TL`)
      : h('p', { class: 'unavailable' }, 'Kur şu an alınamadı. TL fiyatları bu yüzden gösterilemiyor.'),
    usable && fx.changePct !== null ? changeLine(fx.changePct, `önceki TCMB kuruna (${fx.prevClose ? formatDay(fx.prevClose.date) : '—'}) göre`) : null,
    h('div', { class: 'meta' }, sourceLine('Kur', fx, now, fx?.marketOpen)),
  );
}

function assetCard(asset, a, fx, now) {
  if (!a) {
    return h('section', { class: 'card' }, h('h2', {}, asset.name), h('p', { class: 'unavailable' }, 'Bu varlık için veri yok.'));
  }
  const metal = asset.kind === 'metal';
  const tl = a.try;
  const usd = a.usd;
  const unitWord = metal ? 'gram' : '1 adet';
  const children = [
    h('div', { class: 'asset-head' }, h('h2', {}, asset.name), statusPill(metal ? a.ounceUsd : usd, { marketOpen: a.marketOpen, live: a.live, now })),
  ];

  if (isUsable(tl)) {
    children.push(h('div', { class: 'price-main', 'aria-label': `${asset.name} ${unitWord} fiyatı` }, formatTry(String(tl.v))));
    children.push(changeLine(a.change?.tryPct, 'önceki kapanışa göre (TL)'));
  } else {
    const why = isUsable(usd) ? 'Dolar/TL kuru alınamadığı için TL fiyatı hesaplanamadı.' : 'Bu varlığın fiyatı şu an alınamadı.';
    children.push(h('p', { class: 'unavailable' }, why));
  }

  if (isUsable(usd)) {
    const sub = metal
      ? `${formatUsd(String(usd.v))} / gram · Ons ${formatUsd(String(a.ounceUsd.v))}`
      : `${formatUsd(String(usd.v))}`;
    children.push(h('div', { class: 'price-sub' }, sub, a.change?.usdPct !== null && a.change?.usdPct !== undefined ? ` (${formatPercent(String(a.change.usdPct), 2, { signed: true })} USD)` : ''));
  }

  children.push(insightBox(asset, a, null));

  const chart = sparkline(a.spark?.try, { label: `${asset.name} son 30 gün (TL)` });
  if (chart) children.push(chart);

  children.push(
    h(
      'div',
      { class: 'meta' },
      sourceLine(metal ? 'Ons fiyatı' : 'Fiyat', metal ? a.ounceUsd : usd, now, a.live ? true : a.marketOpen),
      isUsable(fx) && isUsable(usd) ? sourceLine('Dolar/TL', fx, now, fx.marketOpen) : null,
    ),
  );
  if (metal) children.push(h('div', { class: 'note' }, `ⓘ ${METAL_NOTE} Formül: ons × Dolar/TL ÷ 31,1035.`));
  return h('section', { class: 'card', 'aria-label': asset.name }, children);
}
