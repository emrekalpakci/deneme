// Terim sözlüğü (arama kutusuyla).

import { h, clear } from '../dom.js';
import { GLOSSARY } from '../../core/glossary.js';
import { lowerTr } from '../../core/news.js';

/** Aramada büyük/küçük harf ve i/ı, ş/s gibi farklar önemsenmez ("rsi" → "RSI"). */
export function fold(s) {
  return lowerTr(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

export function renderGlossary() {
  const list = h('dl', { class: 'card glossary' });
  const fill = (q) => {
    clear(list);
    const needle = fold(q.trim());
    const hits = GLOSSARY.filter((g) => !needle || fold(`${g.term} ${g.text}`).includes(needle));
    if (!hits.length) list.appendChild(h('p', { class: 'meta' }, 'Eşleşen terim yok.'));
    for (const g of hits) list.append(h('dt', {}, g.term), h('dd', {}, g.text));
  };
  fill('');
  return h(
    'div',
    {},
    h('h2', { class: 'section-title' }, 'Sözlük'),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'sr-only' }, 'Terim ara'),
      h('input', { type: 'search', placeholder: 'Terim ara (ör. RSI)', autocomplete: 'off', oninput: (e) => fill(e.target.value) }),
    ),
    list,
  );
}
