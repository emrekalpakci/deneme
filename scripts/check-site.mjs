// Yayın sonrası kontrol: canlı sitenin yeni sürümünün ve verilerin gerçekten yayında olduğunu denetler.
// Bir şey eksikse görev kırmızı görünür (GitHub e-postayla haber verir).
//
// Ortam değişkenleri: SITE_URL (ör. https://emrekalpakci.github.io/deneme/), BUILD_ID (beklenen sürüm, 7 hane)

import { httpGet, sleep } from './lib/http.mjs';

const SITE = (process.env.SITE_URL || 'https://emrekalpakci.github.io/deneme/').replace(/\/?$/, '/');
const BUILD = (process.env.BUILD_ID || '').slice(0, 7);
const bust = () => `?kontrol=${Date.now()}`;

async function get(path) {
  return httpGet(`${SITE}${path}${bust()}`, { retries: 1, timeoutMs: 15000 });
}

async function checkOnce() {
  const problems = [];
  const index = await get('');
  if (!index.ok) return [`Ana sayfa açılmadı (${index.error})`];
  if (BUILD && !index.text.includes(`data-build="${BUILD}"`)) problems.push(`Yeni sürüm (${BUILD}) henüz yayında değil`);
  if (!/Content-Security-Policy/.test(index.text)) problems.push('Güvenlik politikası (CSP) eksik');
  if (!/noindex/.test(index.text)) problems.push('Arama motoru engeli (noindex) eksik');

  const sw = await get('sw.js');
  if (!sw.ok) problems.push(`sw.js açılmadı (${sw.error})`);
  const shell = [...(sw.text.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== './');
  if (!shell.length) problems.push('Çevrimdışı dosya listesi okunamadı');
  for (const f of shell) {
    const r = await get(f);
    if (!r.ok) problems.push(`${f} açılmadı (${r.error})`);
  }

  const manifest = await get('manifest.webmanifest');
  try {
    const m = JSON.parse(manifest.text);
    if (!m.icons?.some((i) => i.sizes === '512x512')) problems.push('Uygulama simgesi (512) eksik');
  } catch {
    problems.push('manifest.webmanifest okunamadı');
  }

  const market = await get('data/market.json');
  try {
    const m = JSON.parse(market.text);
    const ageMin = (Date.now() - Date.parse(m.generatedAt)) / 60000;
    if (m.schemaVersion !== 1) problems.push('market.json sürümü beklenmedik');
    if (!(ageMin < 20)) problems.push(`market.json eski (${Math.round(ageMin)} dk)`);
  } catch {
    problems.push(`market.json okunamadı (${market.error || 'biçim'})`);
  }
  for (const f of ['data/news.json', 'data/history.json']) {
    const r = await get(f);
    if (!r.ok) problems.push(`${f} açılmadı (${r.error})`);
  }
  return problems;
}

// GitHub Pages yeni sürümü dağıtırken birkaç saniye eski sürüm görünebilir: 5 deneme.
let problems = [];
for (let attempt = 1; attempt <= 5; attempt++) {
  problems = await checkOnce();
  if (!problems.length) break;
  console.log(`Deneme ${attempt}: ${problems.length} sorun; 15 sn sonra yeniden bakılacak.`);
  await sleep(15000);
}
if (problems.length) {
  for (const p of problems) console.log(`::error::${p}`);
  process.exit(1);
}
console.log(`Canlı site kontrolü tamam: ${SITE} (sürüm ${BUILD || '-'}), tüm dosyalar ve veriler yayında.`);
