// Satış sinyalleri: her açık pozisyon için kâr hedefi, zarar sınırı, kısmi satış ve trend bozulması.
// Uygulama ve Telegram bildirimi aynı fonksiyonu kullanır.

import { Big, dec } from './money.js';

const HUNDRED = new Big('100');

/**
 * @param {{avgCost: Big, price: number|null, tp: string, sl: string, events?: {type: string, date: string}[]}} p
 * @returns {{plPct: Big|null, signals: {type: string, level: 'info'|'action'|'warning', title: string, text: string}[]}}
 */
export function positionSignals({ avgCost, price, tp, sl, events = [] }) {
  const signals = [];
  if (!avgCost || price === null || price === undefined) return { plPct: null, signals };
  const pl = new Big(String(price)).div(avgCost).minus('1').times(HUNDRED);
  const TP = dec(tp);
  const SL = dec(sl);
  if (pl.gte(TP.times('2'))) {
    signals.push({
      type: 'tp2',
      level: 'action',
      title: 'Kâr hedefinin iki katı',
      text: 'Kârın hedefinin iki katına ulaştı. Kalanın yarısını satıp kârı korumayı düşünebilirsin.',
    });
  } else if (pl.gte(TP)) {
    signals.push({
      type: 'tp',
      level: 'action',
      title: 'Kâr hedefine ulaşıldı',
      text: 'Yarısını satıp kalanın zarar sınırını maliyetine çekmeyi düşünebilirsin. Böylece kalan kısımda zarar etme riskin azalır.',
    });
  } else if (pl.gte(TP.times('0.8'))) {
    signals.push({ type: 'tpNear', level: 'info', title: 'Kâr hedefine yaklaştı', text: 'Kâr hedefinin %80\'ine geldi. Hedefini gözden geçirebilirsin.' });
  }
  if (pl.lte(SL.times('-1'))) {
    signals.push({
      type: 'sl',
      level: 'warning',
      title: 'Zarar sınırına gelindi',
      text: 'Önceden belirlediğin zarar sınırına ulaşıldı. Planına göre satmayı ya da kararını yeniden değerlendirmeyi düşün.',
    });
  } else if (pl.lte(SL.times('-0.8'))) {
    signals.push({ type: 'slNear', level: 'info', title: 'Zarar sınırına yaklaştı', text: 'Zarar sınırının %80\'ine geldi.' });
  }
  for (const e of events) {
    if (e.type === 'below200') {
      signals.push({ type: 'trend', level: 'warning', title: 'Trend bozuldu', text: `Fiyat ${e.date} tarihinde 200 günlük ortalamanın altına indi. Uzun vadeli yön zayıflıyor olabilir.` });
    } else if (e.type === 'deathCross') {
      signals.push({ type: 'trend', level: 'warning', title: 'Trend bozuldu', text: `50 günlük ortalama ${e.date} tarihinde 200 günlüğün altına kesti. Uzun vadeli yön zayıflıyor olabilir.` });
    }
  }
  return { plPct: pl, signals };
}
