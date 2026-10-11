// Para hesapları: kuruşu kuruşuna doğru sonuç için big.js (ondalık sayı) kullanılır.
// Kural: Para tutarları ve miktarlar her zaman metin (string) olarak saklanır,
// hesaplama Big ile yapılır, yuvarlama sadece gösterimde yapılır.
// Big "katı modda": yanlışlıkla ondalıklı JS sayısı (float) verilirse hata verir.

import Big from '../vendor/big.mjs';

Big.strict = true;
Big.RM = 1; // yarım yukarı (ROUND_HALF_UP)
Big.DP = 20;

export { Big };

/** Metin, Big ya da bigint'ten Big üretir. JS sayısı kabul etmez (kayıp olmasın). */
export function dec(x) {
  if (x instanceof Big) return x;
  if (typeof x === 'string' || typeof x === 'bigint') return new Big(x);
  throw new TypeError('dec(): sayı metin olarak verilmeli');
}

/**
 * API'den gelen ondalıklı sayıyı (float) bir kez Big'e çevirir.
 * Sonlu olmayan değerlerde null döner (uydurma 0 üretmez).
 */
export function decFromNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return new Big(String(n));
}

/** Big değeri belirtilen haneye yuvarlayıp JS sayısına çevirir (sadece veri dosyaları için). */
export function toRoundedNumber(x, dp) {
  return Number(dec(x).round(dp, Big.roundHalfUp).toFixed(dp));
}

// ---------------------------------------------------------------------------
// Türkçe sayı girişi
// ---------------------------------------------------------------------------

const GROUPED_DOT = /^\d{1,3}(\.\d{3})+$/; // 1.250.000
const GROUPED_COMMA = /^\d{1,3}(,\d{3})+$/; // 1,250,000

/**
 * Kullanıcının yazdığı sayıyı ayrıştırır.
 * kind = 'amount' (TL tutarı/fiyat) ya da 'quantity' (gram, BTC gibi miktar).
 * Tek nokta belirsizdir: "1.250" tutarda 1250, miktarda 1,25 sayılır.
 * Dönen value: noktalı ondalık metin (ör. "1250.5").
 */
export function parseTrNumber(input, kind = 'amount') {
  if (typeof input !== 'string') return fail('Sayı girin.');
  let s = input
    .replace(/[\s  ]/g, '')
    .replace(/₺|TL|TRY|\$|USD/gi, '');
  if (s === '') return fail('Sayı girin.');
  if (/^[-−]/.test(s)) return fail('Negatif sayı girilemez.');
  if (!/^[\d.,]+$/.test(s)) return fail('Sadece rakam, nokta ve virgül kullanın.');
  if (!/\d/.test(s)) return fail('Sayı girin.');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart;
  let fracPart = '';

  if (lastDot >= 0 && lastComma >= 0) {
    // İkisi de var: sondaki ondalık ayırıcıdır, diğeri binlik ayırıcı olmalı.
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    const [left, right, ...rest] = s.split(decSep);
    if (rest.length > 0 || right === '' || /[.,]/.test(right)) return fail('Sayı biçimi anlaşılamadı.');
    const grouped = thouSep === '.' ? GROUPED_DOT : GROUPED_COMMA;
    if (!grouped.test(left)) return fail('Binlik ayırıcılar hatalı görünüyor.');
    intPart = left.split(thouSep).join('');
    fracPart = right;
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    if (parts.length === 2) {
      [intPart, fracPart] = parts;
      if (fracPart === '') return fail('Virgülden sonra rakam yazın.');
    } else if (GROUPED_COMMA.test(s)) {
      intPart = parts.join('');
    } else {
      return fail('Sayı biçimi anlaşılamadı.');
    }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2) {
      if (!GROUPED_DOT.test(s)) return fail('Sayı biçimi anlaşılamadı.');
      intPart = parts.join('');
    } else {
      const [left, right] = parts;
      if (right === '') return fail('Noktadan sonra rakam yazın.');
      const looksThousands = kind === 'amount' && right.length === 3 && /^[1-9]\d{0,2}$/.test(left);
      if (looksThousands) {
        intPart = left + right;
      } else {
        intPart = left;
        fracPart = right;
      }
    }
  } else {
    intPart = s;
  }

  if (intPart === '') intPart = '0';
  const canonical = fracPart ? `${intPart}.${fracPart}` : intPart;
  const value = new Big(canonical).toString();
  return { ok: true, value, error: null };
}

function fail(error) {
  return { ok: false, value: null, error };
}

// ---------------------------------------------------------------------------
// Türkçe gösterim
// ---------------------------------------------------------------------------

/** Gösterim için: Big, metin ya da (veri dosyasından gelen) sonlu JS sayısı kabul eder. */
function asDec(x) {
  if (typeof x === 'number') {
    const b = decFromNumber(x);
    if (!b) throw new TypeError('Gösterilecek sayı geçersiz');
    return b;
  }
  return dec(x);
}

/** Binlik ayırıcı nokta, ondalık ayırıcı virgül. Yarım yukarı yuvarlar, "-0,00" üretmez. */
export function formatDecimal(x, decimals = 2, { trimZeros = false } = {}) {
  let b = asDec(x).round(decimals, Big.roundHalfUp);
  if (b.eq('0')) b = new Big('0');
  const negative = b.lt('0');
  let [intPart, fracPart = ''] = b.abs().toFixed(decimals).split('.');
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (trimZeros) fracPart = fracPart.replace(/0+$/, '');
  const body = fracPart ? `${intPart},${fracPart}` : intPart;
  return negative ? `−${body}` : body;
}

export function formatTry(x, decimals = 2) {
  return `${formatDecimal(x, decimals)} TL`;
}

export function formatUsd(x, decimals = 2) {
  const s = formatDecimal(x, decimals);
  return s.startsWith('−') ? `−$${s.slice(1)}` : `$${s}`;
}

/** Yüzde: Türkçede işaret başa gelir: "%12,34". signed=true ise "+%12,34" / "−%3,10". */
export function formatPercent(x, decimals = 2, { signed = false } = {}) {
  const s = formatDecimal(x, decimals);
  if (s.startsWith('−')) return `−%${s.slice(1)}`;
  if (signed && !asDec(x).round(decimals, Big.roundHalfUp).eq('0')) return `+%${s}`;
  return `%${s}`;
}

/** Miktar: gereksiz sıfırları atar ("25,5 g", "0,00123 BTC"). */
export function formatQuantity(x, decimals, unitLabel) {
  const s = formatDecimal(x, decimals, { trimZeros: true });
  return unitLabel ? `${s} ${unitLabel}` : s;
}
