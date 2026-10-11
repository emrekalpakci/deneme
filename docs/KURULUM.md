# Kurulum kılavuzu

Bu kılavuz kod bilgisi gerektirmez. Her şey tarayıcıdan ve telefondan yapılır.
Hepsi **ücretsizdir**; kredi kartı istenmez.

---

## A. Gizli depo (portföyün burada durur)

Portföyün ve bildirim kayıtların herkese açık `deneme` deposunda değil, sadece senin
görebildiğin ayrı bir **gizli** depoda saklanır.

1. Şu bağlantıyı aç: <https://github.com/new?name=yatirim-verilerim&visibility=private>
2. **Repository name**: `yatirim-verilerim` yazılı olmalı.
3. **Private** (gizli) seçili olmalı. ⚠️ *Public* seçme.
4. **Add a README file** kutusunu işaretle (ya da "Add README" düğmesini aç).
5. En alttaki yeşil **Create repository** düğmesine bas.

Bildirim görevlerini (dosyaları) bu depoya Claude ekler.

---

## B. Telegram botu

1. Telegram'ı aç, aramaya **@BotFather** yaz (mavi onay işaretli olan) ve sohbeti aç.
2. **Başlat** (Start) düğmesine bas, sonra `/newbot` yaz.
3. Bot için bir ad yaz (ör. `Yatırım Rehberim`).
4. Bot için bir kullanıcı adı yaz. Sonu `bot` ile bitmeli ve kimsede olmamalı
   (ör. `emre_yatirim_rehberi_bot`).
5. BotFather sana uzun bir **anahtar (token)** gönderir. Şuna benzer:
   `1234567890:AAH...`. Bunu **kimseyle paylaşma**. Bir sonraki adımda kullanacaksın.
6. BotFather'ın mesajındaki `t.me/...` bağlantısına dokun, botunun sohbeti açılır.
   **Başlat** (Start) düğmesine bas. Bu, botun sana yazabilmesi için gerekli.

### Bot anahtarını gizli depoya kaydet ("Secret")

1. Gizli deponu aç: `https://github.com/KULLANICI-ADIN/yatirim-verilerim`
2. Üstte **Settings** (Ayarlar) → solda **Secrets and variables** → **Actions**.
3. Yeşil **New repository secret** düğmesine bas.
4. **Name**: `TELEGRAM_BOT_TOKEN` (aynen böyle, büyük harflerle)
5. **Secret**: BotFather'ın verdiği anahtarı yapıştır.
6. **Add secret** düğmesine bas.

Anahtar artık GitHub'da şifreli durur. Kimse (sen dahil) onu tekrar göremez, sadece
bildirim görevi kullanabilir. Değiştirmek istersen aynı yerden yeni değer girersin.

Sohbet numaranı elle bulmana gerek yok: **Telegram kurulumu** görevi, bota "Başlat"
diyen kişiyi bulur, kaydeder ve sana "✅ Kurulum tamamlandı" mesajı gönderir.

---

## C. Telefon için GitHub token'ı (portföy eşitleme)

Uygulamanın portföyü gizli depona yazabilmesi için sadece o depoya, sadece dosya
izniyle sınırlı bir anahtar (token) oluşturulur.

1. Şu bağlantıyı aç (ad, açıklama, süre ve izin hazır gelir):
   <https://github.com/settings/personal-access-tokens/new?name=Yatirim+Rehberi+telefon&description=Portfoy+esitleme&expires_in=365&contents=write>
   Bağlantı açılmazsa: GitHub → sağ üstte profil resmin → **Settings** → en altta
   **Developer settings** → **Personal access tokens** → **Fine-grained tokens** →
   **Generate new token**.
2. **Token name**: `Yatirim Rehberi telefon`
3. **Expiration** (bitiş): **1 yıl** (365 gün ya da "Custom" ile bir yıl sonrası). Bitiş tarihini not al.
4. **Repository access**: **Only select repositories** → listeden **yatirim-verilerim**'i seç.
   ⚠️ "All repositories" seçme.
5. **Permissions** (izinler): **Contents** → **Read and write**.
   (Yeni görünümde "+ Add permissions" → "Contents" → "Read and write".)
   "Metadata: Read-only" kendiliğinden eklenir; başka izin verme.
6. En altta **Generate token** düğmesine bas. `github_pat_` ile başlayan token'ı kopyala.
   GitHub bunu **sadece bir kez** gösterir.
7. Uygulamada **Daha fazla → Ayarlar → Portföy eşitleme** bölümüne:
   - Gizli depo: `KULLANICI-ADIN/yatirim-verilerim`
   - GitHub token: kopyaladığın token
   - Token bitiş tarihi: GitHub'da seçtiğin tarih
   ve **Kaydet ve bağlan**'a bas. "Bağlandı ve eşitlendi" yazmalı.

Token sadece telefonunda saklanır. Telefonu kaybedersen GitHub'da aynı sayfadan
token'ı silebilirsin (**Delete**), portföyün güvende kalır.

---

## D. Bildirimleri dene

1. Gizli deponun **Actions** sekmesini aç.
2. Solda **Telegram kurulumu** → sağda **Run workflow** → yeşil **Run workflow**.
   Bir dakika içinde Telegram'a "✅ Kurulum tamamlandı" mesajı gelir.
3. Solda **Bildirim** → **Run workflow** → **Deneme uyarısı gönder** kutusunu işaretle → **Run workflow**.
   Telegram'a "🧪 DENEME" ile başlayan örnek bir uyarı gelir (gerçek portföyün kullanılmaz).
4. Aynı denemeyi bir kez daha çalıştır: bu sefer "Aynı uyarı ikinci kez gönderilmedi"
   mesajı gelir. Bu, tekrar önlemenin çalıştığını gösterir.

Bundan sonra **Bildirim** görevi her saatin 22. ve 52. dakikasında kendiliğinden çalışır.

---

## Bildirimler nasıl çalışır?

- Portföyündeki her varlık için güncel fiyat, kâr hedefin ve zarar sınırınla karşılaştırılır.
  Hedefler uygulamadaki **Portföy → Hedefleri değiştir** değerleridir.
- Mesaj gelen durumlar: kâr hedefi, kâr hedefinin iki katı, zarar sınırı, trend bozulması.
- **Aynı uyarı tekrar gelmez.** Fiyat seviyeden %3 geri dönerse uyarı yeniden kurulur.
  Yeni alım yaparsan ortalama maliyet değişir; yeni seviye için yeniden uyarı gelebilir.
- Fiyat 75 dakikadan eskiyse uyarı gönderilmez (eski veriyle yanlış alarm olmasın diye).
  3 saat boyunca fiyat alınamazsa günde en fazla bir kez "Veri alınamıyor" mesajı gelir.
- Her Pazartesi sabah kısa bir "sistem çalışıyor" özeti gelir. Ayarlar'dan kapatılabilir.
- Gönderilemeyen mesaj kaydedilmez, sonraki çalıştırmada yeniden denenir.

## Ücretsiz sınır

Gizli depolarda GitHub Actions ayda **2.000 dakika** ücretsizdir. Bildirim görevi günde
48 kez çalışır ve her çalıştırma 1 dakika sayılır: ayda yaklaşık **1.460 dakika**.
Kullanımı GitHub → Settings → **Billing and licensing** → **Usage** sayfasından görebilirsin.
Sınır dolarsa bildirimler ay sonuna kadar durur; kredi kartı eklemediysen **ücret çıkmaz**.

## Görev durursa ne yapılır?

- Uygulamada **Daha fazla → Durum → Telegram bildirimleri** "son kontrol kaydı"nı gösterir.
  4 saatten eskiyse uyarı çıkar.
- Gizli deponun **Actions** sekmesinde **Bildirim** görevine bak. Kırmızı çarpılı
  çalıştırmaya tıkla; hata Türkçe yazar (ör. "Bot anahtarı geçersiz").
- "Bot anahtarı geçersiz": BotFather'da `/mybots` → botun → **API Token** ile anahtarı al,
  B bölümündeki Secret'ı güncelle.
- "Bot sana mesaj gönderemiyor": Telegram'da botunu aç ve **Başlat**'a bas.

## Token'ı yenileme (yılda bir)

Uygulama, token'ın bitmesine 14 gün kala uyarır.
1. C bölümündeki adımlarla yeni token oluştur.
2. Uygulamada **Ayarlar → Portföy eşitleme → Eşitlemeyi kapat**, sonra yeni token'la
   **Kaydet ve bağlan**. Portföyün kaybolmaz.
3. GitHub'da eski token'ı sil.
