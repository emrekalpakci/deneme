# Kararlar

Bu dosya, uygulamadaki kural ve sabitlerin neden böyle seçildiğini kaydeder.
Puanlama sabitleri değişirse `SCORING_VERSION` artırılır ve buraya not düşülür.

## Puanlama sürümü 1 (11.10.2026)

| Gösterge | Ağırlık | Kural (−100…+100) |
|---|---|---|
| Trend | %30 | Fiyat > 200G ortalama ise +50, değilse −50; 50G > 200G ise +50, değilse −50 |
| RSI (14, Wilder) | %20 | 5 × (50 − RSI) |
| Zirveden uzaklık (1 yıl) | %15 | −50 − 150 × (fiyat/zirve − 1) ÷ yıllık oynaklık |
| Oynaklık | %15 | 100 − 200 × (20 günlük oynaklığın son 3 yıldaki yüzdelik sırası) |
| Dolar/TL trendi | %10 | 1000 × (3 aylık değişim − 0,03) |
| Haber puanı | %10 | 5. adımda |

- Göstergeler varlığın **dolar** fiyatıyla hesaplanır; TL'nin değer kaybı ayrı göstergedir.
- Eksik göstergenin ağırlığı diğerlerine dağıtılır.
- Etiket (ilk uyan): Veri yetersiz (ağırlığın < %70'i, trend/RSI yok ya da fiyat eski) →
  Pahalı görünüyor ((RSI + zirve)/2 ≤ −60) → Alım için uygun (toplam ≥ 25 ve trend ≥ 0) → Bekle.
- Güven: varsayılan orta; eşiğe yakınlık, sert oynaklık, eksik/eski veri ya da geçmiş testte zayıf kanıt
  varsa düşük; yüksek için göstergelerin ≥ %80'i aynı yönde, geçmiş testte belirgin üstünlük
  (%95 aralığının alt sınırı tabanın üstünde), normal oynaklık ve kripto olmaması gerekir. "Bekle" asla yüksek değildir.

## Geçmiş test (ilk sonuç, 11.10.2026)

- 90 gün sonraki dolar fiyatıyla ölçülür; al-sat maliyeti metal %1, kripto %0,4.
- İlk sonuç: kurallar dört varlıkta da rastgele bir günde almaktan belirgin şekilde iyi değil;
  sinyale göre al-sat, al-tutun gerisinde. **Ağırlıklar bu sonuca göre değiştirilmedi** (aşırı uyum olmasın).
- Uygulamada bu sonuç olduğu gibi gösterilir; güven seviyeleri bu yüzden çoğunlukla "Düşük"tür.

## Bütçe ayarı

- "Alım için uygun" sadece güven en az "Orta" ise payı ×1,25 artırır (zayıf kanıtla risk artırılmaz).
- "Pahalı görünüyor" payı her zaman ×0,75 azaltır; "Veri yetersiz" varlık plana alınmaz.

## Euro (döviz) eklendi — 11 Ekim 2026
- Euro, "döviz" (`fx`) türünde yatırım aracı olarak eklendi: portföy, analiz etiketi, geçmiş test ve Telegram uyarıları.
- Fiyat: Euro/Dolar paritesi (Swissquote → CoinGecko → currency-api) × Dolar/TL. Geçmiş: Frankfurter (merkez bankaları) EUR→USD, 2016'dan beri.
- Analiz diğer varlıklar gibi dolar fiyatı (parite) üzerinden yapılır; Dolar/TL trendi ayrı göstergedir. Puanlama sabitleri değişmedi (SCORING_VERSION 1).
- Geçmiş testte al-sat maliyeti %1 (banka/döviz bürosu makası). Varsayılan hedefler: kâr +%10, zarar −%5 (döviz daha az oynak).
- Bütçe planlayıcının dağılım tablosuna eklenmedi (payı 0); dağılım tablosu ayrıca karar gerektirir.
- Haberlerde "euro/avro" ancak kur/para bağlamında sayılır (ör. "Euro 2028" spor haberi sayılmaz).

## Dolar yatırım aracı olarak eklendi — 11 Ekim 2026
- Dolar'ın fiyatı Dolar/TL kurudur; dolar fiyatı tanım gereği 1'dir.
- Analiz ve geçmiş test Dolar/TL kuru (TL) üzerinden yapılır; "Dolar/TL trendi" göstergesi Dolar için kullanılmaz (çift sayım olmasın).
- Uyarı: Dolar/TL uzun yıllardır neredeyse kesintisiz yükseldiği için RSI çoğu zaman çok yüksektir; "Pahalı görünüyor" etiketi sık çıkar ve geçmiş testte rastgele günlerden daha kötü sonuç verdi. Bu, ekranda geçmiş test sonucu olarak açıkça gösterilir; kurallar Dolar'a özel olarak değiştirilmedi (SCORING_VERSION 1).
- Haberlerde "dolar" başka bir varlığın fiyat birimiyse (ör. "ons 4.200 dolar") Dolar'a sayılmaz.
