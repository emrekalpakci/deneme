// Ayarlar → Portföy eşitleme (gizli GitHub deposu) ve Telegram bildirimleri.

import { h } from '../dom.js';
import { formatWhen, formatDay } from '../format.js';
import { getSyncConfig, getSyncStatus, connect, disconnect, syncNow, defaultRepo, defaultExpiry, tokenDaysLeft, loadAlertStatus } from '../sync.js';
import { loadPortfolio, savePortfolio } from '../portfolio-store.js';

const form = { repo: '', token: '', expires: '', busy: false, message: null };
const GUIDE_URL = 'https://github.com/emrekalpakci/deneme/blob/main/docs/KURULUM.md';

export function renderSyncSettings(rerender) {
  const cfg = getSyncConfig();
  return [cfg ? connectedCard(cfg, rerender) : connectCard(rerender), telegramCard(cfg, rerender)];
}

function message() {
  if (!form.message) return null;
  return h('div', { class: `note ${form.message.error ? 'warn' : ''}`, role: 'status' }, form.message.text);
}

function connectCard(rerender) {
  form.repo ||= defaultRepo();
  form.expires ||= defaultExpiry();
  const field = (key, label, attrs = {}) =>
    h('label', { class: 'field' }, h('span', {}, label), h('input', { value: form[key], oninput: (e) => (form[key] = e.target.value), ...attrs }));
  const submit = async () => {
    form.busy = true;
    form.message = { text: 'Bağlanılıyor…' };
    rerender();
    const r = await connect({ repo: form.repo, token: form.token, expires: form.expires });
    form.busy = false;
    if (r.ok) {
      form.token = '';
      form.message = { text: 'Bağlandı ve eşitlendi. Portföyün artık gizli deponda da duruyor.' };
    } else {
      form.message = { text: r.error, error: true };
    }
    rerender();
  };
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Portföy eşitleme'),
    h(
      'p',
      { class: 'meta' },
      'Portföyün gizli GitHub deponda saklanır. Böylece telefon değişse de kaybolmaz ve Telegram bildirim görevi aynı veriyi kullanır. ',
      h('a', { href: GUIDE_URL, target: '_blank', rel: 'noopener' }, 'Kurulum kılavuzu'),
    ),
    h(
      'div',
      { class: 'form' },
      field('repo', 'Gizli depo (kullanıcı-adı/depo-adı)', { type: 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', placeholder: 'kullanici-adin/yatirim-verilerim' }),
      field('token', 'GitHub token (github_pat_ ile başlar)', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' }),
      field('expires', 'Token bitiş tarihi', { type: 'date' }),
      message(),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: form.busy, onclick: submit }, form.busy ? 'Bağlanılıyor…' : 'Kaydet ve bağlan')),
    ),
    h(
      'p',
      { class: 'meta' },
      'Token sadece bu telefonda saklanır ve sadece GitHub\'a gönderilir. "Claude\'a sor" metnine ve yedek dosyasına girmez. Token\'a sadece gizli depo için "Contents" izni ver.',
    ),
  );
}

function connectedCard(cfg, rerender) {
  const st = getSyncStatus();
  const days = tokenDaysLeft(cfg);
  const run = async () => {
    form.busy = true;
    rerender();
    const s = await syncNow();
    form.busy = false;
    const what = [s?.pulled ? 'gizli depodaki yeni kayıtlar telefona alındı' : null, s?.pushed ? 'telefondaki değişiklikler gizli depoya yazıldı' : null].filter(Boolean).join('; ');
    form.message = s?.ok ? { text: `Eşitlendi: ${what || 'iki taraf zaten aynı'}.` } : { text: s?.error || 'Eşitlenemedi.', error: true };
    rerender();
  };
  const off = () => {
    if (!confirm('Bu telefondaki token silinsin mi? Portföyün telefonda ve gizli depoda kalır; sadece eşitleme durur.')) return;
    disconnect();
    form.message = { text: 'Eşitleme kapatıldı. Token bu telefondan silindi.' };
    rerender();
  };
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Portföy eşitleme'),
    h(
      'ul',
      { class: 'list' },
      li('Gizli depo', cfg.repo),
      li('Son eşitleme', st ? `${formatWhen(st.at)} · ${st.ok ? 'başarılı' : 'hata'}` : 'henüz yok', st && !st.ok ? 'status-bad' : 'status-ok'),
      li('Token bitişi', days === null ? '—' : `${formatDay(cfg.expires)} (${days < 0 ? 'süresi doldu' : `${days} gün kaldı`})`, days !== null && days <= 14 ? 'status-bad' : ''),
    ),
    st && !st.ok ? h('div', { class: 'note warn' }, st.error) : null,
    days !== null && days <= 14
      ? h('div', { class: 'note warn' }, 'Token\'ın süresi doluyor. GitHub\'da yeni token oluştur (kılavuzdaki adımlar), sonra burada "Eşitlemeyi kapat" ve yeni token\'la tekrar bağlan.')
      : null,
    message(),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', disabled: form.busy, onclick: run }, form.busy ? 'Eşitleniyor…' : 'Şimdi eşitle'),
      h('button', { class: 'btn', type: 'button', onclick: off }, 'Eşitlemeyi kapat'),
    ),
  );
}

function telegramCard(cfg, rerender) {
  const p = loadPortfolio();
  const weekly = p.settings?.alerts?.weekly !== false;
  const toggle = (e) => {
    const q = loadPortfolio();
    q.settings.alerts = { weekly: e.target.checked, updatedAt: new Date().toISOString() };
    savePortfolio(q);
    rerender();
  };
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Telegram bildirimleri'),
    h(
      'p',
      { class: 'meta' },
      'Bildirim görevi gizli deponda 30 dakikada bir çalışır: kâr hedefi, zarar sınırı ve trend bozulmasında Telegram\'a sade bir mesaj atar. Aynı uyarı tekrar gönderilmez. Kâr hedefi ve zarar sınırı Portföy ekranındaki değerlerdir.',
    ),
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: weekly, onchange: toggle }),
      h('span', {}, 'Her Pazartesi "sistem çalışıyor" özeti gönderilsin'),
    ),
    cfg ? null : h('p', { class: 'meta' }, 'Bu ayar eşitleme açıkken bildirim görevine ulaşır.'),
    cfg ? alertStatusList(rerender) : null,
  );
}

let alertView = { loading: false, value: null, at: 0 };

/** Bildirim görevinin durumu (gizli depodan okunur, 5 dakikada bir yenilenir). */
export function alertStatusList(rerender) {
  if (!getSyncConfig()) return alertStatusBlock(null);
  if (!alertView.loading && (!alertView.value || Date.now() - alertView.at > 5 * 60 * 1000)) {
    alertView.loading = true;
    loadAlertStatus().then((v) => {
      alertView = { loading: false, value: v, at: Date.now() };
      rerender();
    });
  }
  const v = alertView.value;
  if (!v) return h('p', { class: 'meta' }, 'Bildirim durumu okunuyor…');
  return alertStatusBlock(v);
}

/** Durum ekranında da kullanılır. */
export function alertStatusBlock(v, now = Date.now()) {
  if (!v) return h('p', { class: 'meta' }, 'Eşitleme kapalı; bildirim durumu okunamıyor.');
  if (!v.ok) return h('p', { class: 'unavailable' }, `Bildirim durumu okunamadı: ${v.error}`);
  const s = v.state;
  const ageH = s?.lastSavedAt ? (now - new Date(s.lastSavedAt).getTime()) / 3600000 : Infinity;
  const recent = (s?.recent || []).filter((r) => r.kind !== 'heartbeat').slice(0, 5);
  return h(
    'div',
    {},
    h(
      'ul',
      { class: 'list' },
      li('Telegram kurulumu', v.telegramReady ? 'tamam' : 'henüz yapılmadı', v.telegramReady ? 'status-ok' : 'status-bad'),
      li('Son kontrol kaydı', s?.lastSavedAt ? `${formatWhen(s.lastRunAt)} · ${s.lastResult || '—'}` : 'henüz yok', ageH <= 4 ? 'status-ok' : 'status-bad'),
    ),
    s?.lastSavedAt && ageH > 4
      ? h('div', { class: 'note warn' }, 'Bildirim görevi 4 saattir kayıt yazmadı. Gizli deponun Actions sekmesinde "Bildirim" görevine bak (kılavuz: "Görev durursa ne yapılır?").')
      : null,
    recent.length
      ? h('div', {}, h('p', { class: 'meta' }, 'Son gönderilen uyarılar:'), h('ul', { class: 'list' }, recent.map((r) => li(formatWhen(r.at), r.title))))
      : h('p', { class: 'meta' }, 'Henüz uyarı gönderilmedi.'),
  );
}

function li(label, value, cls = '') {
  return h('li', {}, h('span', { class: 'label' }, label), h('span', { class: cls }, value));
}
