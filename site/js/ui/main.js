// Uygulamanın başlangıcı: tema, sekmeler, veri yükleme, canlı fiyat ve çevrimdışı uyarısı.

import { h, clear } from './dom.js';
import { load, save } from './store.js';
import { loadMarket, fetchLivePrices, loadHistory, loadNews } from './data.js';
import { applyLivePrices } from '../core/market.js';
import { formatWhen, ageHours } from './format.js';
import { renderMarket } from './views/market.js';
import { renderStatus } from './views/status.js';
import { renderMore, renderSettings, renderAbout } from './views/more.js';
import { renderPortfolio, isPortfolioEditing } from './views/portfolio.js';
import { renderBudget } from './views/budget.js';
import { renderTest } from './views/test.js';
import { renderNews } from './views/news.js';
import { renderGlossary } from './views/glossary.js';
import { openClaudeDialog } from './claude.js';

const BUILD_ID = document.documentElement.dataset.build || '';

const state = {
  market: null, // kayıtlı piyasa özeti (market.json)
  live: null, // tarayıcıda alınan anlık fiyatlar
  fromCache: false,
  error: null,
  now: Date.now(),
  theme: load('theme', 'auto'),
  buildId: BUILD_ID.startsWith('__') ? 'geliştirme' : BUILD_ID,
};

// --- Tema -------------------------------------------------------------------
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
function setTheme(theme) {
  state.theme = theme;
  save('theme', theme);
  applyTheme(theme);
  render({ force: true });
}
applyTheme(state.theme);

// --- Yönlendirme ------------------------------------------------------------
const ROUTES = {
  piyasa: () => renderMarket(viewState()),
  portfoy: () => renderPortfolio({ ...viewState(), rerender: () => render({ force: true }), loadHistory }),
  butce: () => renderBudget({ ...viewState(), rerender: () => render({ force: true }), loadHistory }),
  haberler: () => renderNews({ ...viewState(), rerender: () => render({ force: true }), loadNews }),
  daha: () => renderMore(),
  durum: () => renderStatus(viewState()),
  ayarlar: () => renderSettings({ theme: state.theme, setTheme }),
  sozluk: () => renderGlossary(),
  hakkinda: () => renderAbout(),
  test: () => renderTest(viewState()),
};
const TAB_OF = { durum: 'daha', ayarlar: 'daha', sozluk: 'daha', hakkinda: 'daha', test: 'daha' };

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[r] ? r : 'piyasa';
}

function viewState() {
  const market = state.market && state.live ? applyLivePrices(state.market, state.live, state.now) : state.market;
  return { ...state, market, reload: refresh };
}

/** Otomatik yenilemeler, kullanıcı form doldururken ekranı yeniden çizmez. */
function isBusy() {
  const el = document.activeElement;
  const typing = el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.closest('#view');
  return !!typing || (currentRoute() === 'portfoy' && isPortfolioEditing());
}

function render({ force = false } = {}) {
  state.now = Date.now();
  if (!force && isBusy()) {
    renderBanner();
    return;
  }
  const route = currentRoute();
  const tab = TAB_OF[route] || route;
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const view = document.getElementById('view');
  clear(view).appendChild(ROUTES[route]());
  renderBanner();
}

// --- Uyarı bandı (çevrimdışı / eski veri) -----------------------------------
function renderBanner() {
  const el = document.getElementById('banner');
  let msg = '';
  let error = false;
  if (!state.market && state.error) {
    msg = `Veriler yüklenemedi: ${state.error}.`;
    error = true;
  } else if (state.fromCache) {
    msg = `${state.error || 'Bağlantı sorunu'}. Son kayıtlı veriler gösteriliyor (güncelleme: ${formatWhen(state.market?.generatedAt, state.now)}).`;
  } else if (state.market && ageHours(state.market.generatedAt, state.now) > 1.5) {
    msg = `Veriler ${formatWhen(state.market.generatedAt, state.now)} saatinden beri güncellenmedi. Ayrıntı: Daha fazla → Durum.`;
  }
  el.hidden = !msg;
  el.className = error ? 'banner error' : 'banner';
  el.textContent = msg;
}

// --- Veri -------------------------------------------------------------------
async function refresh({ forceLive = false } = {}) {
  const r = await loadMarket();
  state.market = r.data;
  state.fromCache = r.fromCache;
  state.error = r.error;
  render();
  if (state.market && !state.fromCache) await refreshLive(forceLive);
}

async function refreshLive(force = false) {
  try {
    const prices = await fetchLivePrices(state.market, { force });
    if (prices) state.live = prices;
  } catch {
    /* canlı fiyat alınamazsa kayıtlı veri gösterilmeye devam eder */
  }
  render();
}

document.getElementById('refresh').addEventListener('click', () => {
  loadNews({ force: true }).catch(() => {});
  refresh({ forceLive: true });
});
document.getElementById('ask-claude').addEventListener('click', () => openClaudeDialog({ market: viewState().market, loadNews }));
window.addEventListener('hashchange', () => {
  render({ force: true });
  document.getElementById('view').focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
window.addEventListener('online', () => refresh());
window.addEventListener('offline', () => {
  state.fromCache = !!state.market;
  state.error = 'İnternet bağlantısı yok';
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
setInterval(() => {
  if (document.visibilityState === 'visible' && navigator.onLine !== false) refreshLive();
}, 60_000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.getElementById('view').appendChild(h('p', { class: 'placeholder' }, 'Yükleniyor…'));
refresh();
