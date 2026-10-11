// Durum ekranı: verinin yaşı, kaynakların durumu, geçmiş veri ve sorun çözme adımları.

import { h } from '../dom.js';
import { formatWhen, formatAge, ageHours } from '../format.js';
import { ASSETS } from '../../core/assets.js';
import { formatDecimal } from '../../core/money.js';
import { getSyncConfig, getSyncStatus, tokenDaysLeft } from '../sync.js';
import { alertStatusList } from './sync-settings.js';

const KEY_NAMES = { XAU: 'Ons altın', XAG: 'Ons gümüş', BTC: 'Bitcoin', ETH: 'Ethereum', USDTRY: 'Dolar/TL' };
const PROVIDER_NAMES = {
  goldapi: 'gold-api.com',
  swissquote: 'Swissquote',
  xaus: 'xaus.com',
  currencyapi: 'currency-api',
  coinbase: 'Coinbase',
  bitstamp: 'Bitstamp',
  binance: 'Binance',
  coingecko: 'CoinGecko',
  tcmb: 'TCMB',
};
const ACTIONS_URL = 'https://github.com/emrekalpakci/deneme/actions/workflows/data.yml';

export function renderStatus({ market, now, fromCache, error, buildId, rerender }) {
  const parts = [h('h2', { class: 'section-title' }, 'Veri durumu')];
  if (!market) {
    parts.push(h('div', { class: 'card' }, h('p', { class: 'unavailable' }, `Veri yüklenemedi: ${error || 'bilinmeyen neden'}`)));
    return h('div', {}, parts);
  }

  const age = ageHours(market.generatedAt, now);
  const fresh = age <= 1.5;
  parts.push(
    h(
      'div',
      { class: 'card' },
      h(
        'ul',
        { class: 'list' },
        row('Son otomatik güncelleme', `${formatWhen(market.generatedAt, now)} (${formatAge(market.generatedAt, now)})`, fresh ? 'ok' : 'warn'),
        row('Gösterilen veri', fromCache ? 'Telefondaki son kayıt (çevrimdışı)' : 'İnternetten yeni alındı', fromCache ? 'warn' : 'ok'),
        row('Uygulama sürümü', buildId || market.buildId?.slice(0, 7) || '—'),
        syncRow(now),
      ),
      fresh
        ? null
        : h(
            'div',
            { class: 'note' },
            h('strong', {}, 'Veriler 1,5 saatten uzun süredir güncellenmedi. '),
            'GitHub bazen zamanlanmış görevleri geciktirir. 3 saati geçerse: ',
            h('a', { href: ACTIONS_URL, target: '_blank', rel: 'noopener' }, 'GitHub → Actions → "Veri ve yayın"'),
            ' sayfasını aç. Üstte "This scheduled workflow is disabled" yazıyorsa "Enable workflow" düğmesine bas. ',
            'Yazmıyorsa "Run workflow" ile elle çalıştırabilirsin.',
          ),
    ),
  );

  parts.push(h('h2', { class: 'section-title' }, 'Telegram bildirimleri'), h('div', { class: 'card' }, alertStatusList(rerender)));

  parts.push(h('h2', { class: 'section-title' }, 'Kaynaklar (son çalıştırma)'));
  for (const s of market.sources || []) {
    parts.push(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'asset-head' }, h('h2', {}, KEY_NAMES[s.key] || s.key), s.used ? h('span', { class: 'pill live' }, s.used) : h('span', { class: 'pill' }, 'alınamadı')),
        h(
          'ul',
          { class: 'list' },
          (s.attempts || []).map((a) => row(PROVIDER_NAMES[a.id] || a.id, a.ok ? `çalıştı (${a.ms} ms)` : `hata: ${a.why}`, a.ok ? 'ok' : 'bad')),
        ),
        s.confirmedBy ? h('p', { class: 'meta' }, `Ani değişim ${s.confirmedBy} ile doğrulandı.`) : null,
      ),
    );
  }

  parts.push(h('h2', { class: 'section-title' }, 'Geçmiş veri'));
  parts.push(
    h(
      'div',
      { class: 'card' },
      h(
        'ul',
        { class: 'list' },
        ASSETS.map((a) => row(a.name, `${formatDecimal(String(market.assets?.[a.id]?.historyDays ?? 0), 0)} günlük kapanış`)),
      ),
      h('p', { class: 'meta' }, 'Geçmiş fiyatlar günde bir kez güncellenir ve analizlerde kullanılır.'),
    ),
  );
  return h('div', {}, parts);
}

function row(label, value, tone) {
  const cls = tone === 'ok' ? 'status-ok' : tone === 'bad' ? 'status-bad' : tone === 'warn' ? 'status-warn' : '';
  return h('li', {}, h('span', { class: 'label' }, label), h('span', { class: cls }, value));
}

function syncRow(now) {
  const cfg = getSyncConfig();
  if (!cfg) return row('Portföy eşitleme', 'kapalı (Ayarlar)', 'warn');
  const st = getSyncStatus();
  const days = tokenDaysLeft(cfg, now);
  const tokenText = days === null ? '' : days < 0 ? ' · token süresi doldu' : ` · token ${days} gün geçerli`;
  return row('Portföy eşitleme', `${st ? `${formatWhen(st.at, now)} ${st.ok ? 'başarılı' : 'hata'}` : 'henüz yok'}${tokenText}`, st?.ok && (days === null || days > 14) ? 'ok' : 'bad');
}
