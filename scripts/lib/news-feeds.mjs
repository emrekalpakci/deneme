// Haber akışlarını çeker (sadece GitHub Actions). Başarısız akış atlanır ve nedeni kaydedilir.

import { USER_AGENT, describeError } from './http.mjs';
import { parseFeed, decodeXmlBytes } from '../../site/js/core/news.js';

export const FEEDS = [
  { id: 'haberturk', name: 'Habertürk', url: 'https://www.haberturk.com/rss/ekonomi.xml' },
  { id: 'aa', name: 'Anadolu Ajansı', url: 'https://www.aa.com.tr/tr/rss/default?cat=ekonomi' },
  { id: 'ntv', name: 'NTV', url: 'https://www.ntv.com.tr/ekonomi.rss' },
  { id: 'sozcu', name: 'Sözcü', url: 'https://www.sozcu.com.tr/feeds-rss-category-ekonomi' },
  { id: 'dunya', name: 'Dünya', url: 'https://www.dunya.com/rss?dunya' },
  { id: 'bloomberght', name: 'Bloomberg HT', url: 'https://www.bloomberght.com/rss' },
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'fxstreet', name: 'FXStreet', url: 'https://www.fxstreet.com/rss' },
];

const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

async function fetchFeed(feed) {
  for (const ua of [USER_AGENT, BROWSER_UA]) {
    try {
      const res = await fetch(feed.url, { headers: { 'User-Agent': ua, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15000) });
      if (res.status === 403 && ua === USER_AGENT) continue;
      if (!res.ok) return { ...feed, ok: false, why: `HTTP ${res.status}`, items: [] };
      const xml = decodeXmlBytes(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || '');
      const items = parseFeed(xml);
      return items.length ? { ...feed, ok: true, items } : { ...feed, ok: false, why: 'akışta haber bulunamadı', items: [] };
    } catch (err) {
      if (ua === USER_AGENT) continue;
      return { ...feed, ok: false, why: describeError(err), items: [] };
    }
  }
  return { ...feed, ok: false, why: 'erişim reddedildi', items: [] };
}

export async function fetchAllFeeds() {
  return Promise.all(FEEDS.map(fetchFeed));
}
