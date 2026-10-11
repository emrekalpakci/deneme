// Fiyat dönüşümleri. Formül (kullanıcının istediği gibi):
//   gram fiyatı (TL) = ons fiyatı (USD) × Dolar/TL ÷ 31,1035
// Hesap big.js ile yapılır, tek seferde ve en sonda yuvarlanır.

import { Big, decFromNumber, toRoundedNumber } from './money.js';
import { GRAMS_PER_TROY_OUNCE } from './assets.js';
import { combine } from './datum.js';

const G = new Big(GRAMS_PER_TROY_OUNCE);

/** Ons USD → gram USD (6 hane). */
export function gramUsdFromOunce(ounceUsd) {
  return combine([ounceUsd], (o) => toRoundedNumber(decFromNumber(o).div(G), 6), ounceUsd?.src || 'hesap');
}

/** Ons USD × Dolar/TL ÷ 31,1035 → gram TL (4 hane, gösterimde 2 haneye yuvarlanır). */
export function gramTryFromOunce(ounceUsd, usdTry) {
  return combine(
    [ounceUsd, usdTry],
    (o, r) => toRoundedNumber(decFromNumber(o).times(decFromNumber(r)).div(G), 4),
    'hesap',
  );
}

/** USD fiyatı × Dolar/TL → TL fiyatı (4 hane). */
export function usdToTry(usd, usdTry) {
  return combine(
    [usd, usdTry],
    (u, r) => toRoundedNumber(decFromNumber(u).times(decFromNumber(r)), 4),
    'hesap',
  );
}
