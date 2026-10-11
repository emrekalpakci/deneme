// "Daha fazla" menüsü, Ayarlar, Hakkında ve henüz hazır olmayan bölümler.

import { h } from '../dom.js';

export function renderMore() {
  const link = (href, label, note) =>
    h('a', { href }, h('span', {}, label), h('span', { class: 'meta' }, note || '›'));
  return h(
    'div',
    {},
    h('h2', { class: 'section-title' }, 'Daha fazla'),
    h(
      'nav',
      { class: 'card menu' },
      link('#/durum', 'Durum', 'veri ve kaynaklar ›'),
      link('#/ayarlar', 'Ayarlar', 'tema ›'),
      link('#/sozluk', 'Sözlük', '5. adımda'),
      link('#/hakkinda', 'Hakkında', 'kaynaklar, uyarılar ›'),
    ),
  );
}

export function renderSettings({ theme, setTheme }) {
  const options = [
    ['auto', 'Otomatik'],
    ['light', 'Açık'],
    ['dark', 'Koyu'],
  ];
  return h(
    'div',
    {},
    h('h2', { class: 'section-title' }, 'Ayarlar'),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Tema'),
      h('p', { class: 'meta' }, 'Otomatik: telefonunun açık/koyu ayarını izler.'),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Tema' },
        options.map(([val, label]) =>
          h('button', { type: 'button', 'aria-pressed': String(theme === val), onclick: () => setTheme(val) }, label),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Portföy eşitleme ve Telegram'),
      h('p', { class: 'meta' }, 'Bu ayarlar 6. adımda eklenecek.'),
    ),
  );
}

export function renderAbout() {
  const src = (name, use) => h('li', {}, h('span', {}, name), h('span', { class: 'label' }, use));
  return h(
    'div',
    {},
    h('h2', { class: 'section-title' }, 'Hakkında'),
    h(
      'div',
      { class: 'card' },
      h('p', {}, 'Bu uygulama kişisel kullanım içindir. Bilgilendirme amaçlıdır, yatırım tavsiyesi değildir.'),
      h('p', {}, 'Kesin kazanç yoktur. Fiyatlar düşebilir. Acil durum için ayırdığın parayı yatırma.'),
      h('p', { class: 'meta' }, 'Kimseyi izlemez, reklam yoktur. Ayarların sadece bu telefonda saklanır.'),
    ),
    h('h2', { class: 'section-title' }, 'Veri kaynakları (ücretsiz)'),
    h(
      'div',
      { class: 'card' },
      h(
        'ul',
        { class: 'list' },
        src('gold-api.com', 'ons altın/gümüş'),
        src('Swissquote', 'yedek ons fiyatı, Dolar/TL'),
        src('xaus.com', 'yedek fiyat, altın geçmişi'),
        src('Frankfurter (TCMB, merkez bankaları)', 'kur ve metal geçmişi'),
        src('currency-api', 'yedek günlük veri'),
        src('Coinbase, Bitstamp, Binance', 'kripto fiyatları'),
        src('CoinGecko', 'yedek kur'),
        src('TCMB', 'resmi günlük kur'),
      ),
      h('p', { class: 'meta' }, 'Para hesapları big.js (MIT lisansı) ile yapılır.'),
    ),
  );
}

export function renderComingSoon(title, step, text) {
  return h(
    'div',
    {},
    h('h2', { class: 'section-title' }, title),
    h('div', { class: 'card placeholder' }, h('p', {}, `${title} ${step}. adımda eklenecek.`), text ? h('p', { class: 'meta' }, text) : null),
  );
}
