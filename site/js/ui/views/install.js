// "Telefona kur" ekranı: Android'de tek düğmeyle kurulum, iPhone'da adım adım tarif.

import { h } from '../dom.js';

let deferredPrompt = null;
let installed = false;

/** Tarayıcının "kurulabilir" olayını yakalar (Android Chrome, Edge, Samsung Internet). */
export function watchInstallPrompt(onChange) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    onChange();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    onChange();
  });
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function platform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

const steps = (...items) => h('ol', { class: 'steps' }, items.map((t) => h('li', {}, t)));

export function renderInstall({ rerender }) {
  const p = platform();
  const parts = [h('h2', { class: 'section-title' }, 'Telefona kur')];

  if (isStandalone() || installed) {
    parts.push(
      h(
        'div',
        { class: 'card' },
        h('p', { class: 'status-ok' }, '✓ Uygulama ana ekranında kurulu ve oradan açılmış.'),
        h('p', { class: 'meta' }, 'Güncellemeler kendiliğinden gelir; yeniden kurman gerekmez.'),
      ),
    );
  } else if (deferredPrompt) {
    const install = async () => {
      const ev = deferredPrompt;
      deferredPrompt = null;
      ev.prompt();
      await ev.userChoice.catch(() => null);
      rerender();
    };
    parts.push(
      h(
        'div',
        { class: 'card' },
        h('p', {}, 'Bu telefona tek dokunuşla kurabilirsin. Ana ekranda bir simge olarak durur, tam ekran açılır.'),
        h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: install }, 'Uygulamayı yükle')),
      ),
    );
  }

  if (!isStandalone()) {
    parts.push(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'iPhone (Safari)'),
        steps(
          'Bu sayfayı Safari\'de aç.',
          'Alttaki Paylaş düğmesine dokun (yukarı ok çıkan kare).',
          'Listeyi kaydır, "Ana Ekrana Ekle"ye dokun.',
          'Sağ üstte "Ekle"ye dokun.',
        ),
        h(
          'div',
          { class: 'note warn' },
          'iPhone\'da ana ekrandaki uygulama Safari\'deki ayarları görmez. Eklemeden önce burada ',
          h('strong', {}, 'Ayarlar → Portföy eşitleme → Token\'ı kopyala'),
          '\'ya bas. Sonra ana ekrandaki uygulamada aynı yere yapıştırıp "Kaydet ve bağlan" de. Portföyün gizli deponda olduğu için kendiliğinden gelir.',
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Android (Chrome)'),
        steps(
          'Bu sayfayı Chrome\'da aç.',
          'Sağ üstteki üç noktaya (⋮) dokun.',
          '"Uygulamayı yükle" ya da "Ana ekrana ekle"ye dokun.',
          '"Yükle"ye dokun. Simge ana ekranına gelir.',
        ),
        h('p', { class: 'meta' }, 'Android\'de kurulan uygulama Chrome ile aynı hafızayı kullanır; ayarların ve portföyün aynen kalır.'),
      ),
    );
    if (p !== 'other') parts.push(h('p', { class: 'meta' }, p === 'ios' ? 'Telefonun iPhone görünüyor: üstteki iPhone adımlarını izle.' : 'Telefonun Android görünüyor: Android adımlarını izle.'));
  }

  parts.push(
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Bilmen gerekenler'),
      h(
        'ul',
        { class: 'plain' },
        h('li', {}, 'Uygulama ücretsizdir; mağazadan indirilmez, reklam ve takip yoktur.'),
        h('li', {}, 'İnternet yokken son kaydedilen fiyatları ve portföyünü gösterir.'),
        h('li', {}, 'Bildirimler Telegram\'dan gelir; uygulamanın açık olması gerekmez.'),
      ),
    ),
  );
  return h('div', {}, parts);
}
