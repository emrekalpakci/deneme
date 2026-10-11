// Varlık listesi. Yeni varlık eklemek için bu listeye bir kayıt eklemek yeterlidir.
//
// NASIL YENİ VARLIK EKLENİR?
// 1) Aşağıdaki listeye bir kayıt kopyalayıp değiştirin:
//    - Metal için (ör. platin): kind: 'metal', symbol: 'XPT', unit: 'gram'
//    - Kripto için (ör. Solana): kind: 'crypto', symbol: 'SOL', unit: 'adet'
//    - Döviz için (ör. sterlin): kind: 'fx', symbol: 'GBP' (fiyatı GBP/USD paritesi × Dolar/TL)
// 2) Kripto için Coinbase'de "SOL-USD" gibi bir çift olmalıdır; metal için gold-api.com
//    sembolü desteklemelidir. Kaynak testi (Actions → "Kaynak testi") bunu doğrular.
// 3) Bütçe planlayıcıdaki dağılım tabloları yeni varlığı otomatik içermez (pay 0 kalır).

export const GRAMS_PER_TROY_OUNCE = '31.1035';

export const ASSETS = Object.freeze([
  {
    // Dolar: fiyatı doğrudan Dolar/TL kurudur; analizi TL fiyatı (kur) üzerinden yapılır.
    id: 'dolar',
    name: 'Dolar',
    shortName: 'Dolar',
    kind: 'fx',
    symbol: 'USD',
    unit: 'dolar',
    unitLabel: '$',
    qtyDecimals: 2,
    priceDecimals: 4,
    qtyExample: '500',
    defaults: { tp: '10', sl: '5' },
  },
  {
    id: 'euro',
    name: 'Euro',
    shortName: 'Euro',
    kind: 'fx',
    symbol: 'EUR',
    unit: 'euro',
    unitLabel: '€',
    qtyDecimals: 2,
    priceDecimals: 4,
    qtyExample: '500',
    defaults: { tp: '10', sl: '5' },
  },
  {
    id: 'gram-altin',
    name: 'Gram Altın',
    shortName: 'Altın',
    kind: 'metal',
    symbol: 'XAU',
    unit: 'gram',
    unitLabel: 'g',
    qtyDecimals: 4,
    defaults: { tp: '15', sl: '8' },
  },
  {
    id: 'gram-gumus',
    name: 'Gram Gümüş',
    shortName: 'Gümüş',
    kind: 'metal',
    symbol: 'XAG',
    unit: 'gram',
    unitLabel: 'g',
    qtyDecimals: 4,
    defaults: { tp: '15', sl: '8' },
  },
  {
    id: 'btc',
    name: 'Bitcoin',
    shortName: 'BTC',
    kind: 'crypto',
    symbol: 'BTC',
    unit: 'adet',
    unitLabel: 'BTC',
    qtyDecimals: 8,
    defaults: { tp: '30', sl: '15' },
  },
  {
    id: 'eth',
    name: 'Ethereum',
    shortName: 'ETH',
    kind: 'crypto',
    symbol: 'ETH',
    unit: 'adet',
    unitLabel: 'ETH',
    qtyDecimals: 8,
    defaults: { tp: '30', sl: '15' },
  },
]);

export const METAL_NOTE = 'Hesaplanan fiyat; kuyumcu ve banka fiyatından farklı olabilir.';

export function getAsset(id) {
  return ASSETS.find((a) => a.id === id) || null;
}

export const metals = () => ASSETS.filter((a) => a.kind === 'metal');
export const cryptos = () => ASSETS.filter((a) => a.kind === 'crypto');
export const currencies = () => ASSETS.filter((a) => a.kind === 'fx');

/** Dolar'ın kendisi: dolar fiyatı her zaman 1'dir, TL fiyatı Dolar/TL kurudur. */
export const isDollar = (asset) => asset?.symbol === 'USD';

/** Fiyat gösterim hanesi: döviz 4 hane (49,2706 TL), diğerleri 2 hane. */
export const priceDecimals = (asset) => asset?.priceDecimals ?? 2;
