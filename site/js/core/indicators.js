// Teknik göstergeler. Tüm seriler "nedenseldir": i. değer sadece 0..i verisiyle hesaplanır
// (geleceğe bakış yok). Hesaplanamayan yerler null'dır.

/** Basit hareketli ortalama serisi. */
export function smaSeries(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Wilder yöntemiyle RSI serisi (varsayılan 14). */
export function rsiSeries(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  const rsi = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  out[n] = rsi();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
    avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = rsi();
  }
  return out;
}

/** Son n değerin en yükseği (bugün dahil). */
export function rollingMaxSeries(values, n) {
  const out = new Array(values.length).fill(null);
  const dq = []; // azalan sırada indeksler
  for (let i = 0; i < values.length; i++) {
    while (dq.length && values[dq[dq.length - 1]] <= values[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n - 1) out[i] = values[dq[0]];
  }
  return out;
}

/** Yıllıklandırılmış oynaklık: son n günlük log getirilerinin standart sapması × √(yıldaki gün). */
export function volatilitySeries(values, n, periodsPerYear) {
  const out = new Array(values.length).fill(null);
  const r = values.map((v, i) => (i === 0 ? null : Math.log(v / values[i - 1])));
  for (let i = n; i < values.length; i++) {
    const w = r.slice(i - n + 1, i + 1);
    const mean = w.reduce((s, x) => s + x, 0) / n;
    const varc = w.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
    out[i] = Math.sqrt(varc) * Math.sqrt(periodsPerYear);
  }
  return out;
}

/**
 * Yüzdelik sıra: bugünkü değerin, önceki `window` değer içindeki yeri (0 = en düşük, 1 = en yüksek).
 * En az `minCount` geçmiş değer yoksa null.
 */
export function percentRankSeries(values, window, minCount) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    const past = [];
    for (let j = Math.max(0, i - window); j < i; j++) if (values[j] !== null) past.push(values[j]);
    if (past.length < minCount) continue;
    out[i] = past.filter((x) => x < values[i]).length / past.length;
  }
  return out;
}

/** k adım önceye göre oransal değişim. */
export function changeSeries(values, k) {
  return values.map((v, i) => (i >= k ? v / values[i - k] - 1 : null));
}
