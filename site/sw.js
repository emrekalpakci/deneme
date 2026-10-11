// Servis çalışanı: "önce internet, olmazsa kayıtlı kopya".
// Böylece yeni sürüm hemen görünür; internet yokken son kayıtlı uygulama ve veri açılır.
const VERSION = '__BUILD_ID__';
const CACHE = `yr-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'js/ui/main.js',
  'js/ui/dom.js',
  'js/ui/store.js',
  'js/ui/data.js',
  'js/ui/format.js',
  'js/ui/chart.js',
  'js/ui/views/market.js',
  'js/ui/views/status.js',
  'js/ui/views/more.js',
  'js/ui/views/portfolio.js',
  'js/ui/views/budget.js',
  'js/core/budget.js',
  'js/core/scenarios.js',
  'js/core/indicators.js',
  'js/core/scoring.js',
  'js/core/backtest.js',
  'js/core/analysis.js',
  'js/core/signals.js',
  'js/ui/views/insight.js',
  'js/ui/views/test.js',
  'js/ui/views/news.js',
  'js/ui/views/glossary.js',
  'js/ui/claude.js',
  'js/core/news.js',
  'js/core/glossary.js',
  'js/core/prompt.js',
  'js/ui/portfolio-store.js',
  'js/ui/sync.js',
  'js/ui/views/sync-settings.js',
  'js/ui/views/install.js',
  'js/core/sync.js',
  'js/core/portfolio.js',
  'js/core/assets.js',
  'js/core/convert.js',
  'js/core/datum.js',
  'js/core/market.js',
  'js/core/market-hours.js',
  'js/core/money.js',
  'js/core/series.js',
  'js/core/sources.js',
  'js/vendor/big.mjs',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('yr-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // dış istekler (API) dokunulmadan geçer
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), NETWORK_TIMEOUT_MS);
    if (res.ok) cache.put(stripQuery(req), res.clone());
    return res;
  } catch {
    const hit = (await cache.match(stripQuery(req))) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return markCached(hit);
    return new Response('Çevrimdışı ve kayıtlı kopya yok.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

// Kayıtlı kopyadan dönen yanıt işaretlenir; uygulama "internetten yeni alındı" demesin diye.
function markCached(res) {
  const headers = new Headers(res.headers);
  headers.set('X-Yr-Kayitli', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Veri dosyaları "?t=..." ile istenir; önbellekte tek kopya tutulur.
function stripQuery(req) {
  const url = new URL(req.url);
  if (!url.search) return req;
  url.search = '';
  return new Request(url.toString());
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('zaman aşımı')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
