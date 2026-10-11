// "Claude'a sor": verileri hazır talimatla panoya kopyalar. Hiçbir yere gönderilmez.

import { h, clear } from './dom.js';
import { buildClaudePrompt } from '../core/prompt.js';
import { ASSETS } from '../core/assets.js';
import { isUsable } from '../core/datum.js';
import { valuePortfolio, targetsFor } from '../core/portfolio.js';
import { positionSignals } from '../core/signals.js';
import { loadPortfolio } from './portfolio-store.js';

export async function openClaudeDialog({ market, loadNews }) {
  let news = null;
  try {
    news = await loadNews();
  } catch {
    news = null;
  }
  const portfolio = loadPortfolio();
  const prices = Object.fromEntries(ASSETS.map((a) => [a.id, market?.assets?.[a.id]?.try]));
  const valuation = valuePortfolio(portfolio.tx, prices);
  const signals = {};
  for (const r of valuation.rows.filter((x) => !x.closed)) {
    const t = targetsFor(portfolio, r.asset);
    signals[r.asset] = positionSignals({
      avgCost: r.avgCost,
      price: isUsable(r.price) ? r.price.v : null,
      tp: t.tp,
      sl: t.sl,
      events: market?.assets?.[r.asset]?.analysis?.events || [],
    }).signals;
  }
  const text = buildClaudePrompt({ market, valuation, targets: (id) => targetsFor(portfolio, id), signals, news });

  let dlg = document.getElementById('claude-dialog');
  if (!dlg) {
    dlg = h('dialog', { id: 'claude-dialog', 'aria-labelledby': 'claude-title' });
    document.body.appendChild(dlg);
  }
  const area = h('textarea', { readonly: true, 'aria-label': 'Kopyalanacak metin' }, text);
  const status = h('p', { class: 'meta', role: 'status', 'aria-live': 'polite' }, '');
  const openLink = h('a', { class: 'btn', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener noreferrer', hidden: true }, "claude.ai'yi aç ›");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Kopyalandı. Şimdi claude.ai\'yi açıp mesaj kutusuna yapıştır (uzun bas → Yapıştır).';
    } catch {
      area.focus();
      area.select();
      const ok = document.execCommand && document.execCommand('copy');
      status.textContent = ok
        ? 'Kopyalandı. Şimdi claude.ai\'yi açıp yapıştır.'
        : 'Otomatik kopyalanamadı. Metin seçildi: uzun basıp "Kopyala"yı seç.';
    }
    openLink.hidden = false;
  };
  clear(dlg).append(
    h('h2', { id: 'claude-title' }, "Claude'a sor"),
    h(
      'p',
      { class: 'meta' },
      'Fiyatlar, analiz, portföyün ve son haber başlıkları aşağıdaki metne hazırlandı. Uygulama bu metni hiçbir yere göndermez; sen kopyalayıp claude.ai\'ye kendin yapıştırırsın. Gizli bilgi (token vb.) içermez.',
    ),
    area,
    status,
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: copy }, 'Kopyala'),
      openLink,
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Kapat'),
    ),
  );
  dlg.showModal();
}
