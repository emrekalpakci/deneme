# Yatırım Rehberi

Küçük yatırımcılar için Türkçe, ücretsiz, telefona kurulabilen yatırım rehberi.
Gram altın, gram gümüş, Bitcoin ve Ethereum'u TL ve dolar olarak izler.

**Uygulama:** <https://emrekalpakci.github.io/deneme/>
**Kurulum ve bakım kılavuzu:** [docs/KURULUM.md](docs/KURULUM.md)

> Bu bilgilendirmedir, yatırım tavsiyesi değildir. Kesin kazanç yoktur; fiyatlar düşebilir.
> Acil durum için ayırdığın parayı yatırma.

## Neler var?

| Ekran | Ne yapar |
|---|---|
| Piyasa | Güncel fiyatlar (her rakamın yanında saat ve kaynak), "Alım için uygun / Bekle / Pahalı görünüyor" etiketi, güven seviyesi ve gerekçe |
| Portföy | Alım-satım kaydı, ortalama maliyet, kâr/zarar, kâr hedefi ve zarar sınırı, satış sinyalleri |
| Bütçe | Bütçe, vade ve riske göre dağılım önerisi, iyi/orta/kötü senaryolar, aylık parçalı alım planı |
| Haberler | Son 72 saatin başlıkları, varlıklara göre etiket ve basit olumlu/olumsuz puan |
| Daha fazla | Strateji testi (geçmiş başarı oranı), Durum, Ayarlar, Sözlük, Telefona kur |
| Claude'a sor | Fiyatları, analizi ve portföyünü hazır bir metin olarak kopyalar; claude.ai'ye yapıştırırsın |
| Telegram | Kâr hedefi, zarar sınırı ve trend bozulmasında bildirim (gizli depodaki görevle) |

## Nasıl çalışır?

- **Veri görevi** (bu depoda, `.github/workflows/data.yml`): 30 dakikada bir ücretsiz ve anahtarsız
  kaynaklardan fiyat ve haber çeker, analizi yapar, siteyi GitHub Pages'te yayınlar.
- **Gizli depo** (`yatirim-verilerim`): Portföyün ve bildirim kayıtların sadece orada durur.
  Oradaki **Bildirim** görevi 30 dakikada bir portföyünü kontrol edip Telegram'a yazar.
- Fiyat ya da haber asla uydurulmaz: alınamayan veri "alınamadı" diye gösterilir.
- Gram fiyatı = ons fiyatı × Dolar/TL ÷ 31,1035 (hesaplanan fiyat; kuyumcu fiyatından farklı olabilir).

Her şey ücretsizdir: GitHub Pages, GitHub Actions, Telegram ve açık veri kaynakları.
Ayrıntılar ve ileride ücret çıkarabilecek noktalar için kılavuza bak.

## Geliştirme

- Testler: `npm test` (Node 22, ek kurulum gerekmez)
- Kaynak testi: `npm run probe` (internet gerekir)
- Yapay zeka asistanlarıyla bakım kuralları: [CLAUDE.md](CLAUDE.md)
- Analiz kararları: [docs/KARARLAR.md](docs/KARARLAR.md)
