// Telegram kurulum görevi (gizli depoda, elle bir kez çalıştırılır).
// Bota /start yazan kişinin sohbet numarasını bulur, telegram.json'a yazar ve deneme mesajı gönderir.
// Böylece sohbet numarasını elle bulup kopyalamak gerekmez.
//
// Ortam değişkenleri: DATA_DIR (gizli deponun klasörü), TELEGRAM_BOT_TOKEN (GitHub Secret)

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { telegramClient, privateChats } from './lib/telegram.mjs';

const DATA_DIR = process.env.DATA_DIR || '.';
const fail = (msg) => {
  console.log(`::error::${msg}`);
  process.exit(1);
};

let bot;
try {
  bot = telegramClient(process.env.TELEGRAM_BOT_TOKEN);
} catch (err) {
  fail(err.message);
}

const me = await bot.getMe();
if (!me.ok) fail(me.error);
const username = me.result.username;
console.log(`Bot bulundu: @${username}`);

const updates = await bot.getUpdates();
if (!updates.ok) fail(updates.error);
const chats = privateChats(updates.result);
if (chats.length === 0) {
  fail(`Bota henüz kimse yazmamış. Telegram'da @${username} botunu aç, "Başlat" (/start) düğmesine bas, sonra bu görevi yeniden çalıştır.`);
}
if (chats.length > 1) {
  fail(`Bota ${chats.length} farklı kişi yazmış; hangisinin sen olduğun anlaşılamadı. @BotFather'da /revoke ile yeni anahtar al, Secret'ı güncelle, botuna sadece sen /start yaz ve bu görevi yeniden çalıştır.`);
}

const chat = chats[0];
const sent = await bot.send(
  chat.id,
  `✅ Kurulum tamamlandı!\n\nYatırım Rehberi bildirimleri bu sohbete gelecek:\n• Kâr hedefine ya da zarar sınırına gelindiğinde\n• Trend bozulduğunda\n• Her Pazartesi kısa bir "sistem çalışıyor" özeti\n\nAynı uyarı tekrar tekrar gönderilmez. Bu bilgilendirmedir, yatırım tavsiyesi değildir.`,
);
if (!sent.ok) fail(sent.error);

await writeFile(join(DATA_DIR, 'telegram.json'), `${JSON.stringify({ chatId: chat.id, bot: username, setAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`Sohbet bulundu (${chat.firstName || 'isimsiz'}) ve kaydedildi. Telegram'a deneme mesajı gönderildi.`);
