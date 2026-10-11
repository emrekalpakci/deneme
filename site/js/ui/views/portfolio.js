// Portföy ekranı: özet, pozisyonlar, işlem ekleme, işlem geçmişi, hedefler ve yedek.

import { h } from '../dom.js';
import { formatWhen, formatDay } from '../format.js';
import { Big, dec, parseTrNumber, formatTry, formatDecimal, formatPercent, formatQuantity, formatUsd } from '../../core/money.js';
import { ASSETS, getAsset } from '../../core/assets.js';
import { isUsable } from '../../core/datum.js';
import { valueOn } from '../../core/series.js';
import { valuePortfolio, validateTx, targetLevels, targetsFor, sortTx, unitPrice, newId } from '../../core/portfolio.js';
import { positionSignals } from '../../core/signals.js';
import { loadPortfolio, savePortfolio, downloadBackup, readBackup, replaceWithBackup } from '../portfolio-store.js';
import { getSyncConfig, getSyncStatus } from '../sync.js';

const DISCLAIMER = 'Bu bilgilendirmedir, yatırım tavsiyesi değildir.';
const todayTr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

// Ekranın kendi durumu (form açıkken otomatik yenileme formu bozmasın diye burada tutulur).
const ui = { form: null, editTargets: null, message: null, showAllTx: false };

export function isPortfolioEditing() {
  return !!(ui.form || ui.editTargets);
}

function blankForm(asset = 'gram-altin') {
  return { type: 'buy', asset, mode: 'unit', qty: '', price: '', total: '', usd: '', fx: '', fxNote: '', date: todayTr(), fee: '0', note: '', errors: [] };
}

export function renderPortfolio(ctx) {
  const portfolio = loadPortfolio();
  const prices = Object.fromEntries(ASSETS.map((a) => [a.id, ctx.market?.assets?.[a.id]?.try]));
  const v = valuePortfolio(portfolio.tx, prices);
  const hasTx = portfolio.tx.some((t) => !t.deleted);
  const rerender = ctx.rerender;

  const parts = [];
  if (ui.message) parts.push(h('div', { class: `banner ${ui.message.error ? 'error' : ''}`, role: 'status' }, ui.message.text));

  if (ui.form) parts.push(renderForm(ctx, portfolio));
  else {
    parts.push(
      h(
        'div',
        { class: 'row toolbar' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ((ui.form = blankForm()), (ui.message = null), rerender()) }, '+ İşlem ekle'),
      ),
    );
  }

  if (!hasTx && !ui.form) {
    parts.push(
      h(
        'div',
        { class: 'card placeholder' },
        h('p', {}, 'Henüz işlem yok.'),
        h('p', { class: 'meta' }, '"İşlem ekle" ile aldığın altın, gümüş ya da kriptoyu gir. Ortalama maliyet ve kâr/zarar otomatik hesaplanır.'),
      ),
    );
  }

  if (hasTx) {
    parts.push(summaryCard(v, ctx));
    parts.push(h('h2', { class: 'section-title' }, 'Pozisyonlar'));
    for (const r of v.rows) parts.push(positionCard(r, portfolio, ctx, rerender));
    for (const e of v.errors) parts.push(h('p', { class: 'unavailable' }, `Uyarı: ${getAsset(e.asset)?.name}: ${e.message}. Bu satış hesaba katılmadı.`));
    parts.push(historyCard(portfolio, rerender));
  }

  parts.push(backupCard(portfolio, rerender));
  parts.push(h('p', { class: 'disclaimer' }, DISCLAIMER));
  return h('div', {}, parts);
}

// --- Özet ----------------------------------------------------------------------

function plText(amount, pct) {
  if (amount === null || amount === undefined) return h('span', {}, '—');
  const n = Number(amount.toFixed(2));
  const cls = n > 0 ? 'change up' : n < 0 ? 'change down' : 'change';
  const word = n > 0 ? 'kâr' : n < 0 ? 'zarar' : 'başa baş';
  const sign = n > 0 ? '+' : '';
  const pctText = pct !== null && pct !== undefined ? ` (${formatPercent(pct.round(2), 2, { signed: true })})` : '';
  return h('span', { class: cls }, `${sign}${formatTry(amount)}${pctText} ${word}`);
}

function summaryCard(v, ctx) {
  const t = v.totals;
  return h(
    'section',
    { class: 'card', 'aria-label': 'Portföy özeti' },
    h('h2', {}, 'Toplam'),
    t.partial
      ? h('div', {}, h('div', { class: 'price-main' }, `${formatTry(t.valueKnown)}+`), h('p', { class: 'unavailable' }, 'Bazı varlıkların fiyatı şu an alınamadı; toplam eksik gösteriliyor.'))
      : h('div', { class: 'price-main' }, formatTry(t.value)),
    h('div', {}, plText(t.partial ? t.unrealizedKnown : t.unrealized, t.pct), h('span', { class: 'meta' }, ' · eldeki varlıklar')),
    h(
      'ul',
      { class: 'list' },
      li('Eldekilerin maliyeti (komisyon dahil)', formatTry(t.cost)),
      li('Satışlardan gerçekleşen kâr/zarar', plText(t.realized, null)),
    ),
    h('p', { class: 'meta' }, `Değerler, Piyasa ekranındaki fiyatlarla hesaplanır (otomatik güncelleme: ${formatWhen(ctx.market?.generatedAt, ctx.now)}).`),
  );
}

function li(label, value) {
  return h('li', {}, h('span', { class: 'label' }, label), value instanceof Node ? value : h('span', {}, value));
}

// --- Pozisyon kartı ------------------------------------------------------------------

function positionCard(r, portfolio, ctx, rerender) {
  const a = getAsset(r.asset);
  const qtyText = formatQuantity(r.qty, a.qtyDecimals, a.unitLabel);
  if (r.closed) {
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'asset-head' }, h('h2', {}, a.name), h('span', { class: 'pill' }, 'Kapandı')),
      h('ul', { class: 'list' }, li('Gerçekleşen kâr/zarar', plText(r.realized, null))),
    );
  }
  const unitWord = a.kind === 'metal' ? 'g' : a.unitLabel;
  const children = [h('div', { class: 'asset-head' }, h('h2', {}, a.name), h('span', { class: 'pill' }, qtyText))];
  if (r.value) {
    children.push(h('div', { class: 'price-main' }, formatTry(r.value)));
    children.push(h('div', {}, plText(r.unrealized, r.pct)));
  } else {
    children.push(h('p', { class: 'unavailable' }, `Güncel fiyat alınamadı (${r.price?.why || 'veri yok'}); değer ve kâr/zarar hesaplanamıyor.`));
  }
  const t = targetsFor(portfolio, r.asset);
  const lv = targetLevels(r.avgCost, t.tp, t.sl);
  children.push(
    h(
      'ul',
      { class: 'list' },
      li('Ortalama maliyet', `${formatTry(r.avgCost)} / ${unitWord}`),
      li('Güncel fiyat', isUsable(r.price) ? `${formatTry(String(r.price.v))} / ${unitWord} · ${priceWhen(r, ctx)}` : 'yok'),
      li('Toplam maliyet', formatTry(r.cost)),
      r.realized.eq('0') ? null : li('Gerçekleşen kâr/zarar', plText(r.realized, null)),
      li(`Kâr hedefi (+%${formatDecimal(t.tp, 2, { trimZeros: true })})`, `${formatTry(lv.takeProfit)} / ${unitWord}`),
      li(`Zarar sınırı (−%${formatDecimal(t.sl, 2, { trimZeros: true })})`, `${formatTry(lv.stopLoss)} / ${unitWord}`),
    ),
  );
  if (ui.editTargets?.asset === r.asset) children.push(targetsForm(portfolio, r.asset, rerender));
  else {
    children.push(
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => ((ui.editTargets = { asset: r.asset, tp: t.tp, sl: t.sl, errors: [] }), rerender()) }, 'Hedefleri değiştir'),
        h('button', { class: 'btn', type: 'button', onclick: () => ((ui.form = { ...blankForm(r.asset), type: 'sell' }), (ui.message = null), rerender()) }, 'Satış gir'),
      ),
    );
  }
  const m = ctx.market?.assets?.[r.asset];
  const { signals } = positionSignals({
    avgCost: r.avgCost,
    price: isUsable(r.price) ? r.price.v : null,
    tp: t.tp,
    sl: t.sl,
    events: m?.analysis?.events || [],
  });
  if (!isUsable(r.price)) children.push(h('p', { class: 'meta' }, 'Fiyat alınamadığı için satış sinyali hesaplanamadı.'));
  else if (!signals.length) children.push(h('p', { class: 'meta' }, 'Şu an satış sinyali yok: kâr hedefi, zarar sınırı ve trend açısından bir uyarı bulunmuyor.'));
  for (const sg of signals) {
    children.push(h('div', { class: `signal ${sg.level}` }, h('strong', {}, sg.title), h('div', {}, sg.text)));
  }
  if (signals.length) children.push(h('p', { class: 'meta' }, 'Bu bilgilendirmedir, yatırım tavsiyesi değildir. Karar senin.'));
  return h('section', { class: 'card', 'aria-label': a.name }, children);
}

function priceWhen(r, ctx) {
  const m = ctx.market?.assets?.[r.asset];
  if (m?.live) return 'canlı';
  if (m?.marketOpen === false) return 'piyasa kapalı, son işlem';
  // TL fiyatın zamanı kurun zamanıdır; kullanıcıya varlığın kendi fiyat saatini gösteririz.
  const own = (m?.kind === 'metal' ? m.ounceUsd : m?.usd)?.asOf || r.price.asOf;
  return `${formatWhen(own, ctx.now)} itibarıyla`;
}

function targetsForm(portfolio, assetId, rerender) {
  const st = ui.editTargets;
  const input = (key, label) =>
    h(
      'label',
      { class: 'field' },
      h('span', {}, label),
      h('input', { type: 'text', inputmode: 'decimal', value: st[key], oninput: (e) => (st[key] = e.target.value) }),
    );
  const save = () => {
    const tp = parseTrNumber(String(st.tp), 'quantity');
    const sl = parseTrNumber(String(st.sl), 'quantity');
    st.errors = [];
    if (!tp.ok || new Big(tp.value).lte('0') || new Big(tp.value).gt('1000')) st.errors.push('Kâr hedefi 0 ile 1000 arasında bir yüzde olmalı.');
    if (!sl.ok || new Big(sl.value).lte('0') || new Big(sl.value).gte('100')) st.errors.push('Zarar sınırı 0 ile 100 arasında bir yüzde olmalı.');
    if (!st.errors.length) {
      portfolio.settings.targets[assetId] = { tp: tp.value, sl: sl.value, updatedAt: new Date().toISOString() };
      savePortfolio(portfolio);
      ui.editTargets = null;
      ui.message = { text: 'Hedefler kaydedildi.' };
    }
    rerender();
  };
  return h(
    'div',
    { class: 'form' },
    input('tp', 'Kâr hedefi (%)'),
    input('sl', 'Zarar sınırı (%)'),
    st.errors.map((e) => h('p', { class: 'unavailable' }, e)),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Kaydet'),
      h('button', { class: 'btn', type: 'button', onclick: () => ((ui.editTargets = null), rerender()) }, 'Vazgeç'),
    ),
  );
}

// --- İşlem formu ---------------------------------------------------------------------

/** Formdaki metinlerden işlem kaydını hesaplar; eksik/yanlış alan varsa hataları döner. */
export function buildTxFromForm(f) {
  const errors = [];
  const asset = getAsset(f.asset);
  const qty = parseTrNumber(f.qty, asset?.kind === 'fx' ? 'amount' : 'quantity'); // dövizde "1.000" bin demektir
  if (!qty.ok) errors.push(`Miktar: ${qty.error}`);
  const fee = f.fee === '' ? { ok: true, value: '0' } : parseTrNumber(f.fee, 'amount');
  if (!fee.ok) errors.push(`Komisyon: ${fee.error}`);
  let amount = null;
  let extra = {};
  if (f.mode === 'unit') {
    const p = parseTrNumber(f.price, 'amount');
    if (!p.ok) errors.push(`Birim fiyat: ${p.error}`);
    else if (qty.ok) amount = new Big(qty.value).times(p.value);
  } else if (f.mode === 'total') {
    const t = parseTrNumber(f.total, 'amount');
    if (!t.ok) errors.push(`Toplam tutar: ${t.error}`);
    else amount = new Big(t.value);
  } else {
    const u = parseTrNumber(f.usd, 'amount');
    const r = parseTrNumber(f.fx, 'amount');
    if (!u.ok) errors.push(`USD birim fiyat: ${u.error}`);
    if (!r.ok) errors.push(`Dolar/TL kuru: ${r.error}`);
    if (u.ok && r.ok && qty.ok) {
      amount = new Big(qty.value).times(u.value).times(r.value);
      extra = { priceUsd: u.value, fxRate: r.value };
    }
  }
  if (errors.length || !asset) return { errors: errors.length ? errors : ['Varlık seçin.'] };
  const now = new Date().toISOString();
  const tx = {
    id: newId(),
    type: f.type,
    asset: f.asset,
    date: f.date,
    qty: qty.value,
    amountTry: amount.round(2, Big.roundHalfUp).toFixed(2),
    feeTry: new Big(fee.value).round(2, Big.roundHalfUp).toFixed(2),
    ...extra,
    note: f.note ? String(f.note).slice(0, 200) : undefined,
    createdAt: now,
    updatedAt: now,
  };
  if (new Big(tx.amountTry).lte('0')) return { errors: ['Tutar sıfırdan büyük olmalı.'] };
  return { tx, errors: [] };
}

function renderForm(ctx, portfolio) {
  const f = ui.form;
  const rerender = ctx.rerender;
  const a = getAsset(f.asset);
  const preview = h('div', { class: 'note', 'aria-live': 'polite' });
  const updatePreview = () => {
    const { tx, errors } = buildTxFromForm(f);
    preview.textContent = '';
    if (!tx) {
      preview.textContent = errors.length && (f.qty || f.price || f.total || f.usd) ? errors.join(' ') : 'Miktarı ve fiyatı yazınca burada hesaplanan toplam görünür.';
      return;
    }
    const total = new Big(tx.amountTry);
    const fee = new Big(tx.feeTry);
    const grand = f.type === 'buy' ? total.plus(fee) : total.minus(fee);
    preview.append(
      h('div', {}, `Algılanan miktar: ${formatQuantity(tx.qty, a.qtyDecimals, a.unitLabel)}`),
      h('div', {}, `Birim fiyat: ${formatTry(unitPrice(tx))} / ${a.kind === 'metal' ? 'g' : a.unitLabel}`),
      h('div', {}, `İşlem tutarı: ${formatTry(total)} · Komisyon: ${formatTry(fee)}`),
      h('strong', {}, f.type === 'buy' ? `Toplam ödenen: ${formatTry(grand)}` : `Eline geçen: ${formatTry(grand)}`),
    );
  };

  const text = (key, label, opts = {}) =>
    h(
      'label',
      { class: 'field' },
      h('span', {}, label),
      h('input', {
        type: opts.type || 'text',
        inputmode: opts.inputmode || 'decimal',
        value: f[key],
        placeholder: opts.placeholder || '',
        max: opts.max,
        autocomplete: 'off',
        oninput: (e) => {
          f[key] = e.target.value;
          if (key === 'date' && f.mode === 'usd') fillFx(ctx, rerender);
          updatePreview();
        },
      }),
      opts.hint ? h('span', { class: 'meta' }, opts.hint) : null,
    );

  const seg = (key, options) =>
    h(
      'div',
      { class: 'segmented', role: 'group' },
      options.map(([val, label]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(f[key] === val),
            onclick: () => {
              f[key] = val;
              if (key === 'mode' && val === 'usd') fillFx(ctx, rerender);
              rerender();
            },
          },
          label,
        ),
      ),
    );

  const save = () => {
    const { tx, errors } = buildTxFromForm(f);
    f.errors = errors.length ? errors : validateTx(tx, portfolio.tx, todayTr());
    if (!f.errors.length) {
      portfolio.tx.push(tx);
      savePortfolio(portfolio);
      ui.form = null;
      ui.message = { text: `${a.name} ${f.type === 'buy' ? 'alışı' : 'satışı'} kaydedildi.` };
    }
    rerender();
  };

  const unitHint = a.kind === 'metal' ? 'gram olarak (ör. 2,5)' : `${a.unitLabel} olarak (ör. ${a.qtyExample || '0,0015'})`;
  const form = h(
    'section',
    { class: 'card form', 'aria-label': 'İşlem ekle' },
    h('h2', {}, 'İşlem ekle'),
    seg('type', [
      ['buy', 'Alış'],
      ['sell', 'Satış'],
    ]),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Varlık'),
      h(
        'select',
        { onchange: (e) => ((f.asset = e.target.value), rerender()) },
        ASSETS.map((x) => h('option', { value: x.id, selected: x.id === f.asset }, x.name)),
      ),
    ),
    text('qty', 'Miktar', { hint: unitHint }),
    h('span', { class: 'field-label' }, 'Fiyatı nasıl gireceksin?'),
    seg('mode', [
      ['unit', 'Birim fiyat (TL)'],
      ['total', 'Toplam tutar (TL)'],
      ['usd', 'Birim fiyat (USD)'],
    ]),
    f.mode === 'unit' ? text('price', `1 ${a.kind === 'metal' ? 'gram' : a.unitLabel} fiyatı (TL)`, { hint: 'Ör. 4.512,30' }) : null,
    f.mode === 'total' ? text('total', 'Ödediğin / aldığın toplam tutar (TL, komisyon hariç)', { hint: 'Ör. 16.500' }) : null,
    f.mode === 'usd' ? text('usd', `1 ${a.kind === 'metal' ? 'gram' : a.unitLabel} fiyatı (USD)`) : null,
    f.mode === 'usd' ? text('fx', 'Dolar/TL kuru', { hint: f.fxNote || 'O günün kuru' }) : null,
    text('date', 'Tarih', { type: 'date', inputmode: 'none', max: todayTr() }),
    text('fee', 'Komisyon (TL)', { hint: 'Yoksa 0 bırak' }),
    text('note', 'Not (isteğe bağlı)', { inputmode: 'text' }),
    preview,
    f.errors.map((e) => h('p', { class: 'unavailable' }, e)),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Kaydet'),
      h('button', { class: 'btn', type: 'button', onclick: () => ((ui.form = null), rerender()) }, 'Vazgeç'),
    ),
  );
  updatePreview();
  return form;
}

/** USD ile girişte kur kutusunu o günün TCMB kuruyla doldurur (kullanıcı değiştirebilir). */
function fillFx(ctx, rerender) {
  const f = ui.form;
  ctx
    .loadHistory()
    .then((hist) => {
      const pts = hist?.series?.USDTRY?.points || [];
      const r = valueOn(pts, f.date, { ffill: true, maxGapDays: 5 });
      if (ui.form !== f) return;
      if (r) {
        f.fx = formatDecimal(String(r), 4);
        f.fxNote = `${formatDay(f.date)} için TCMB kuru otomatik yazıldı; istersen değiştir.`;
      } else {
        f.fxNote = 'Bu tarih için kur bulunamadı; kuru kendin yaz.';
      }
      rerender();
    })
    .catch(() => {
      f.fxNote = 'Kur geçmişi yüklenemedi; kuru kendin yaz.';
      rerender();
    });
}

// --- İşlem geçmişi ve yedek ---------------------------------------------------------

function historyCard(portfolio, rerender) {
  const list = sortTx(portfolio.tx.filter((t) => !t.deleted)).reverse();
  const shown = ui.showAllTx ? list : list.slice(0, 10);
  const del = (t) => {
    if (!confirm('Bu işlem silinsin mi? Hesaplar yeniden yapılır.')) return;
    const others = portfolio.tx.filter((x) => !x.deleted && x.id !== t.id);
    // Silmek, sonraki bir satışı "fazla satış" yapıyorsa izin verilmez.
    const check = others.filter((x) => x.type === 'sell').some((s) => validateTx(s, others.filter((o) => o.id !== s.id), '9999-12-31').length);
    if (check) {
      ui.message = { text: 'Bu alım silinemez: sonraki bir satış elindekinden fazla hale gelir. Önce o satışı sil.', error: true };
    } else {
      t.deleted = true;
      t.updatedAt = new Date().toISOString();
      savePortfolio(portfolio);
      ui.message = { text: 'İşlem silindi.' };
    }
    rerender();
  };
  return h(
    'section',
    { class: 'card', 'aria-label': 'İşlem geçmişi' },
    h('h2', {}, 'İşlem geçmişi'),
    h(
      'ul',
      { class: 'list' },
      shown.map((t) => {
        const a = getAsset(t.asset);
        const unit = a.kind === 'metal' ? 'g' : a.unitLabel;
        return h(
          'li',
          { class: 'tx' },
          h(
            'div',
            {},
            h('strong', {}, `${t.type === 'buy' ? 'Alış' : 'Satış'} · ${a.name}`),
            h('div', { class: 'meta' }, `${formatDay(t.date)} · ${formatQuantity(t.qty, a.qtyDecimals, a.unitLabel)} × ${formatTry(unitPrice(t))}/${unit}`),
            h('div', { class: 'meta' }, `Tutar ${formatTry(t.amountTry)} · Komisyon ${formatTry(t.feeTry || '0')}${t.priceUsd ? ` · ${formatUsd(t.priceUsd)} × ${formatDecimal(t.fxRate, 4)}` : ''}`),
            t.note ? h('div', { class: 'meta' }, `Not: ${t.note}`) : null,
          ),
          h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'İşlemi sil', onclick: () => del(t) }, 'Sil'),
        );
      }),
    ),
    list.length > 10
      ? h('button', { class: 'btn', type: 'button', onclick: () => ((ui.showAllTx = !ui.showAllTx), rerender()) }, ui.showAllTx ? 'Daha az göster' : `Tümünü göster (${list.length})`)
      : null,
  );
}

function backupCard(portfolio, rerender) {
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'sr-only',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const { portfolio: p, errors } = await readBackup(file);
      if (errors.length) ui.message = { text: `Yedek yüklenemedi: ${errors.slice(0, 3).join(' ')}`, error: true };
      else if (confirm('Yedekteki portföy, telefondaki portföyün yerine geçecek. Devam edilsin mi?')) {
        savePortfolio(replaceWithBackup(portfolio, p));
        ui.message = { text: 'Yedek yüklendi.' };
      }
      rerender();
    },
  });
  return h(
    'section',
    { class: 'card', 'aria-label': 'Yedek' },
    h('h2', {}, 'Yedek'),
    syncNote(),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => downloadBackup(portfolio) }, 'Yedeği indir'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Yedekten yükle'),
      fileInput,
    ),
  );
}

function syncNote() {
  const cfg = getSyncConfig();
  if (!cfg) {
    return h(
      'p',
      { class: 'meta' },
      'Portföyün sadece bu telefonda saklanıyor. Telefon değişirse ya da tarayıcı verileri silinirse kaybolabilir. ',
      h('a', { href: '#/ayarlar' }, 'Ayarlar → Portföy eşitleme'),
      ' ile gizli GitHub deponla eşitlemeyi aç ya da ara sıra yedek indir.',
    );
  }
  const st = getSyncStatus();
  return h(
    'p',
    { class: st && !st.ok ? 'unavailable' : 'meta' },
    st?.ok
      ? `Portföyün gizli deponla (${cfg.repo}) eşitleniyor. Son eşitleme: ${formatWhen(st.at)}. Bildirim görevi de bu veriyi kullanır.`
      : st
        ? `Eşitleme hatası: ${st.error} Değişikliklerin telefonda duruyor; bağlantı düzelince gönderilir.`
        : `Portföyün gizli deponla (${cfg.repo}) eşitleniyor.`,
  );
}
