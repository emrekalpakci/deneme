# Yatırım Rehberi — Bakım kuralları (yapay zeka asistanları için)

Bu depo, kod bilmeyen bir kullanıcının kişisel yatırım rehberi uygulamasıdır (Türkçe PWA).
Her değişiklikte aşağıdaki kurallara uy.

## Değişmez kurallar
1. **Ücretsiz kal.** Ücretli API, abonelik, sunucu, veritabanı ya da yapay zeka API'si ekleme.
2. **Bağımlılık ekleme.** Derleme adımı yok; tek dış kod `site/js/vendor/big.mjs` (MIT).
3. **Veri uydurma.** Eksik/eski veri asla 0 ya da güncel değer gibi kullanılmaz.
   Her değer `datum.js` biçiminde (değer, zaman, kaynak, durum) taşınır; eksikse "yok" gösterilir.
4. **Kişisel veri yazdırma.** Bu depo herkese açık ve Actions kayıtları (log) herkese görünür.
   Portföy, token, Telegram bilgisi bu depoda ve loglarda asla yer almaz.
   Hata mesajlarına yanıt gövdesi ekleme (`scripts/lib/http.mjs`).
5. **Para hesabı big.js ile.** Tutar/miktar metin (string) olarak saklanır; `money.js` dışında
   para için düz JS sayı aritmetiği yapma. Yuvarlama sadece gösterimde.
6. **Puanlama sabitleri** (`scoring` modülü) sürüm numarası artırılmadan değiştirilmez;
   değişiklik `docs/KARARLAR.md`'ye yazılır. Ağırlıklar geçmiş veriye göre ayarlanmaz.
7. **Dürüstlük.** Kesin kazanç vaadi yok; öneri ekranlarında
   "Bu bilgilendirmedir, yatırım tavsiyesi değildir." notu kalır.
8. **Dil.** Arayüz metinleri Türkçe, kısa ve jargonsuz.

## Yapı
- `site/` → GitHub Pages'te yayınlanan uygulama. `site/js/core/` saf hesap modülleri
  (tarayıcı ve Node'da aynen çalışır), `site/js/ui/` ekranlar.
- `scripts/` → GitHub Actions'ta çalışan Node 22 betikleri (veri çekme, kaynak testi).
- `tests/unit/` → `npm test` (Node'un kendi test aracı, bağımlılık yok).
- `.github/workflows/` → `ci.yml` (testler), `probe.yml` (kaynak testi).

## Komutlar
- Testler: `npm test`
- Kaynak testi (ağ gerekir): `npm run probe`
