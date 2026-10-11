// Strateji testi ekranı: kuralların geçmişteki başarısı, açık ve dürüst biçimde.

import { h } from '../dom.js';
import { ASSETS } from '../../core/assets.js';
import { backtestCard } from './insight.js';

function honestNote(assets) {
  const tested = assets.filter(([, m]) => m?.backtest?.available).map(([, m]) => m.backtest);
  if (!tested.length) return h('p', { class: 'unavailable' }, 'Geçmiş test sonucu henüz yok.');
  const anyGood = tested.some((bt) => bt.buy.verdict.level === 'moderate' || bt.expensive.verdict.level === 'moderate');
  const allBehind = tested.every((bt) => bt.timing.ret < bt.hold.ret);
  return h(
    'p',
    { class: 'note warn' },
    h('strong', {}, 'Dürüst sonuç: '),
    anyGood
      ? 'Bazı varlıklarda sinyaller geçmişte rastgele günlerden daha başarılı görünüyor, ama örnek sayısı sınırlı. '
      : 'Bu basit kurallar geçmişte rastgele bir günde işlem yapmaktan belirgin şekilde daha iyi sonuç vermedi. ',
    allBehind ? 'Sinyale göre al-sat, her varlıkta "al ve tut" yaklaşımının gerisinde kaldı. ' : '',
    'Etiketleri kesin bir al-sat talimatı olarak değil, piyasanın şu anki durumunu özetleyen bir gösterge olarak düşün.',
  );
}

export function renderTest({ market }) {
  const assets = ASSETS.map((a) => [a, market?.assets?.[a.id]]);
  const summary = assets
    .filter(([, m]) => m?.backtest?.available)
    .map(([a, m]) => {
      const bt = m.backtest;
      const beatHold = bt.timing.ret > bt.hold.ret;
      return `${a.name}: al-sat ${beatHold ? 'al-tutu geçti' : 'al-tutun gerisinde kaldı'}; "Alım için uygun" isabeti rastgeleye göre ${bt.buy.edgePp >= 0 ? '+' : '−'}${Math.abs(bt.buy.edgePp).toFixed(1).replace('.', ',')} puan.`;
    });
  return h(
    'div',
    {},
    h('h2', { class: 'section-title' }, 'Strateji testi (geçmiş veri)'),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Özet'),
      h(
        'p',
        {},
        'Ana ekrandaki etiketler sabit kurallarla hesaplanır. Bu kuralların, geçmişte her gün sadece o güne kadarki veriyle hesaplanıp 90 gün sonraki fiyatla karşılaştırılmasının sonuçları aşağıdadır.',
      ),
      h('ul', { class: 'list' }, summary.map((s) => h('li', {}, s))),
      honestNote(assets),
      h(
        'ul',
        { class: 'rules meta' },
        h('li', {}, 'Test edilen göstergeler: trend, RSI, zirveden uzaklık, oynaklık. Haber ve Dolar/TL göstergeleri geçmişte test edilemedi.'),
        h('li', {}, 'Başarı dolar fiyatıyla ölçüldü (TL\'nin değer kaybı karışmasın diye), al-sat maliyeti dahil.'),
        h('li', {}, 'Ardışık günler aynı fırsatı tekrar saymasın diye en az 90 gün arayla "bağımsız" örnekler ayrıca sayıldı; 10\'dan azsa hüküm verilmez.'),
        h('li', {}, 'Kurallar ve ağırlıklar bu sonuçlara göre ayarlanmadı; ayarlansaydı test kendini kandırmış olurdu.'),
        h('li', {}, 'Geçmiş, geleceği garanti etmez.'),
      ),
    ),
    assets.map(([a, m]) => backtestCard(a, m)),
    h('p', { class: 'disclaimer' }, 'Bu bilgilendirmedir, yatırım tavsiyesi değildir.'),
  );
}
