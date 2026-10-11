# Yatırım verilerim (gizli)

Bu depo **gizli** kalmalı. Yatırım Rehberi uygulamasının kişisel verileri burada durur:

| Dosya | Ne işe yarar | Kim yazar |
|---|---|---|
| `portfoy.json` | Alım-satım işlemlerin ve hedeflerin | Telefondaki uygulama |
| `bildirim-durumu.json` | Hangi uyarının gönderildiği (tekrar gelmesin diye) | Bildirim görevi |
| `telegram.json` | Bildirimlerin gideceği Telegram sohbeti | Telegram kurulum görevi |

Bot anahtarı bu dosyalarda **değil**, Settings → Secrets bölümünde saklanır.

Görevler (Actions sekmesi):
- **Bildirim**: 30 dakikada bir çalışır. Elle "Run workflow" → "Deneme uyarısı gönder" ile denenebilir.
- **Telegram kurulumu**: Bir kez, bota /start yazdıktan sonra çalıştırılır.

Ayrıntılı kılavuz: https://github.com/emrekalpakci/deneme/blob/main/docs/KURULUM.md
