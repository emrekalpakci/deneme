// "Claude'a sor" metni: fiyatlar (saatleriyle), analiz, portföy ve haber başlıkları + sabit talimat.
// Bu metin sadece panoya kopyalanır; hiçbir yapay zeka servisine gönderilmez. Token ya da gizli bilgi içermez.

import { ASSETS } from './assets.js';
import { isUsable } from './datum.js';
import { formatTry, formatUsd, formatPercent, formatDecimal, formatQuantity, decFromNumber } from './money.js';

export const INSTRUCTION = 'Bu verilere göre portföyümü sade bir dille değerlendir, riskleri belirt.';

const fmt = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const when = (iso) => (iso ? fmt.format(new Date(iso)) : 'zaman bilinmiyor');
const pctOf = (x) => formatPercent(decFromNumber(x).round(2), 2, { signed: true });
const SENT = { 1: 'olumlu', 0: 'nötr', '-1': 'olumsuz' };

function priceLine(asset, a, fx) {
  if (!a) return `- ${asset.name}: veri yok`;
  const parts = [];
  if (isUsable(a.try)) parts.push(`${formatTry(String(a.try.v))}${asset.kind === 'metal' ? '/gram' : ''}`);
  else parts.push(`TL fiyatı alınamadı (${a.try?.why || 'veri yok'})`);
  const usd = asset.kind === 'metal' ? a.ounceUsd : a.usd;
  if (isUsable(usd)) parts.push(`${asset.kind === 'metal' ? 'ons ' : ''}${formatUsd(String(usd.v))} (${usd.src}, ${when(usd.asOf)}${a.marketOpen === false ? ', piyasa kapalı' : ''})`);
  else parts.push(`USD fiyatı alınamadı (${usd?.why || 'veri yok'})`);
  if (a.change?.tryPct !== null && a.change?.tryPct !== undefined) parts.push(`önceki kapanışa göre ${pctOf(a.change.tryPct)} (TL)`);
  return `- ${asset.name}: ${parts.join('; ')}`;
}

function analysisLine(asset, a) {
  const an = a?.analysis;
  if (!an) return `- ${asset.name}: analiz yok`;
  const conf = an.confidence ? `, güven ${an.confidence.text.toLowerCase()}` : '';
  const score = an.total === null || an.total === undefined ? '' : `puan ${an.total}`;
  return `- ${asset.name}: ${an.labelText} (${score}${conf}). ${an.reasons.join(' ')}`;
}

/**
 * @param {{ market, valuation?: {rows, totals}, targets?: (assetId)=>{tp, sl}, signals?: Record<string, {title: string}[]>,
 *           news?: {items: any[]} | null, now?: number }} input
 */
export function buildClaudePrompt({ market, valuation = null, targets = null, signals = {}, news = null, now = Date.now() }) {
  const L = [INSTRUCTION, ''];
  L.push(`Tarih: ${when(new Date(now).toISOString())} (Türkiye saati)`);
  L.push('Notlar: Gram fiyatları ons × Dolar/TL ÷ 31,1035 ile hesaplanmıştır; kuyumcu/banka fiyatından farklı olabilir.');
  L.push('Etiketler basit sabit kurallardan üretilir; geçmiş veri testinde rastgele bir günde almaktan belirgin şekilde iyi sonuç vermemiştir.');
  L.push('');

  L.push('FİYATLAR');
  const fx = market?.fx?.USDTRY;
  L.push(
    isUsable(fx)
      ? `- Dolar/TL: ${formatDecimal(String(fx.v), 4)} (${fx.src}, ${when(fx.asOf)}${fx.marketOpen === false ? ', piyasa kapalı' : ''})`
      : `- Dolar/TL: alınamadı (${fx?.why || 'veri yok'})`,
  );
  for (const asset of ASSETS) L.push(priceLine(asset, market?.assets?.[asset.id], fx));
  L.push('');

  L.push('ANALİZ (her gösterge −100 ile +100 arası puanlanır)');
  for (const asset of ASSETS) L.push(analysisLine(asset, market?.assets?.[asset.id]));
  L.push('');

  L.push('PORTFÖYÜM');
  const open = valuation?.rows?.filter((r) => !r.closed) || [];
  if (!open.length) {
    L.push('- Portföyüm boş ya da girilmedi; genel bir değerlendirme istiyorum.');
  } else {
    for (const r of open) {
      const asset = ASSETS.find((x) => x.id === r.asset);
      const unit = asset.kind === 'metal' ? 'g' : asset.unitLabel;
      const t = targets ? targets(r.asset) : null;
      const pl = r.unrealized ? `kâr/zarar ${formatTry(r.unrealized)} (${formatPercent(r.pct.round(2), 2, { signed: true })})` : 'güncel fiyat alınamadığı için kâr/zarar hesaplanamadı';
      const value = r.value ? `güncel değer ${formatTry(r.value)}` : 'güncel değer bilinmiyor';
      const sig = signals[r.asset]?.length ? `; sinyal: ${signals[r.asset].map((s) => s.title).join(', ')}` : '';
      const tgt = t ? `; kâr hedefi %${t.tp}, zarar sınırı %${t.sl}` : '';
      L.push(`- ${asset.name}: ${formatQuantity(r.qty, asset.qtyDecimals, unit)}, ortalama maliyet ${formatTry(r.avgCost)}/${unit}, ${value}, ${pl}${tgt}${sig}`);
    }
    const t = valuation.totals;
    L.push(
      t.partial
        ? `- Toplam: bazı fiyatlar alınamadığı için eksik; bilinen değer ${formatTry(t.valueKnown)}, maliyet ${formatTry(t.cost)}`
        : `- Toplam: değer ${formatTry(t.value)}, maliyet ${formatTry(t.cost)}, kâr/zarar ${formatTry(t.unrealized)}${t.pct ? ` (${formatPercent(t.pct.round(2), 2, { signed: true })})` : ''}`,
    );
    if (!t.realized.eq('0')) L.push(`- Satışlardan gerçekleşen kâr/zarar: ${formatTry(t.realized)}`);
  }
  L.push('');

  L.push('SON HABER BAŞLIKLARI (anahtar kelimeyle otomatik puanlandı; yanılabilir)');
  const items = (news?.items || []).filter((i) => i.assets?.length).slice(0, 12);
  if (!news) L.push('- Haber başlıkları yüklenemedi.');
  else if (!items.length) L.push('- Son 72 saatte bu varlıklarla ilgili başlık bulunamadı.');
  for (const i of items) L.push(`- [${SENT[i.sentiment]}] ${i.title} (${i.source}, ${when(i.publishedAt)})`);
  L.push('');
  L.push('Lütfen kesin al-sat tavsiyesi verme; olasılıkları, riskleri ve dikkat etmem gerekenleri sade bir dille anlat.');
  return L.join('\n');
}
