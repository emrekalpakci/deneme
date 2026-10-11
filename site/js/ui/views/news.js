// Haberler ekranı: başlık, kaynak, saat, bağlantı ve anahtar kelimeyle olumlu/olumsuz/nötr etiketi.

import { h } from '../dom.js';
import { formatWhen } from '../format.js';
import { ASSETS, getAsset } from '../../core/assets.js';
import { describeLoadError } from '../data.js';

const ui = { filter: 'all', news: null, error: null, loading: false };
const SENT = { 1: ['Olumlu', 'up'], 0: ['Nötr', ''], '-1': ['Olumsuz', 'down'] };

export function renderNews(ctx) {
  if (!ui.news && !ui.loading && !ui.error) load(ctx);
  const parts = [h('h2', { class: 'section-title' }, 'Haberler (son 72 saat)')];
  if (ui.loading && !ui.news) parts.push(h('p', { class: 'placeholder' }, 'Haberler yükleniyor…'));
  if (ui.error && !ui.news) {
    parts.push(
      h(
        'div',
        { class: 'card' },
        h('p', { class: 'unavailable' }, `Haberler yüklenemedi: ${ui.error}.`),
        h('button', { class: 'btn', type: 'button', onclick: () => ((ui.error = null), load(ctx)) }, 'Tekrar dene'),
      ),
    );
  }
  if (ui.news) parts.push(...content(ctx));
  parts.push(h('p', { class: 'disclaimer' }, 'Bu bilgilendirmedir, yatırım tavsiyesi değildir.'));
  return h('div', {}, parts);
}

function load(ctx) {
  ui.loading = true;
  ctx
    .loadNews()
    .then((n) => (ui.news = n))
    .catch((e) => (ui.error = describeLoadError(e)))
    .finally(() => {
      ui.loading = false;
      ctx.rerender();
    });
}

function content(ctx) {
  const n = ui.news;
  const okFeeds = n.feeds.filter((f) => f.ok);
  const scores = h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Haber puanı'),
    h(
      'ul',
      { class: 'list' },
      ASSETS.map((a) => {
        const s = n.perAsset?.[a.id];
        const v = s?.score;
        const text = v === null || v === undefined ? `yeterli haber yok (${s?.n || 0})` : `${v > 0 ? '+' : ''}${v} · ${s.n} haber`;
        return h('li', {}, h('span', { class: 'label' }, a.name), h('span', { class: v > 20 ? 'up' : v < -20 ? 'down' : '' }, text));
      }),
    ),
    h(
      'p',
      { class: 'meta' },
      'Puan −100 (hep olumsuz) ile +100 (hep olumlu) arasıdır; yeni haberler daha ağır sayılır, en az 3 haber gerekir. Analizde %10 ağırlıkla kullanılır. ',
      'Puan sadece kelimelere bakar: "düşmedi" gibi olumsuzlukları, iğneli dili ya da mecazı ("gümüş madalya") anlamayabilir.',
    ),
    h('p', { class: 'meta' }, `Güncelleme: ${formatWhen(n.generatedAt, ctx.now)} · Çalışan akış: ${okFeeds.length}/${n.feeds.length}`),
    n.feeds.some((f) => !f.ok) ? h('p', { class: 'meta' }, `Alınamayan akışlar: ${n.feeds.filter((f) => !f.ok).map((f) => `${f.name} (${f.why})`).join(', ')}`) : null,
  );
  const options = [['all', 'Tümü'], ...ASSETS.map((a) => [a.id, a.shortName]), ['eco', 'Ekonomi']];
  const filterBar = h(
    'div',
    { class: 'segmented filter', role: 'group', 'aria-label': 'Varlığa göre süz' },
    options.map(([val, label]) => h('button', { type: 'button', 'aria-pressed': String(ui.filter === val), onclick: () => ((ui.filter = val), ctx.rerender()) }, label)),
  );
  // "Tümü": bu varlıklarla ilgili başlıklar; "Ekonomi": akışlardaki tüm ekonomi başlıkları.
  const items = n.items.filter((i) => (ui.filter === 'eco' ? true : ui.filter === 'all' ? i.assets.length > 0 : i.assets.includes(ui.filter)));
  const list = items.length
    ? h(
        'ul',
        { class: 'card news-list' },
        items.slice(0, 80).map((i) => {
          const [label, cls] = SENT[i.sentiment];
          const words = [...i.hits.pos, ...i.hits.neg];
          return h(
            'li',
            { class: 'news-item' },
            h('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer' }, i.title),
            h(
              'div',
              { class: 'meta' },
              h('span', { class: `pill ${cls === 'up' ? 'live' : cls === 'down' ? 'neg' : ''}` }, label),
              ` ${i.source} · ${formatWhen(i.publishedAt, ctx.now)}`,
              i.assets.length ? ` · ${i.assets.map((a) => getAsset(a).shortName).join(', ')}` : '',
              words.length ? ` · kelimeler: ${words.join(', ')}` : '',
            ),
          );
        }),
      )
    : h('p', { class: 'card placeholder' }, 'Bu süzgeçte son 72 saatte haber yok.');
  return [scores, filterBar, list];
}
