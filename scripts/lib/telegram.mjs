// Telegram Bot API (ücretsiz). Bot anahtarı sadece ortam değişkeninden (GitHub Secret) okunur;
// hiçbir mesajda ya da hata metninde yer almaz.

import { describeError, sleep } from './http.mjs';

const API = 'https://api.telegram.org';

/** Hata metninden bot anahtarını siler (her ihtimale karşı). */
export function redact(text, token) {
  let s = String(text ?? '');
  if (token) s = s.split(token).join('***');
  return s.replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot***');
}

/**
 * @param {string} token
 * @param {{fetch?: typeof fetch, wait?: (ms: number) => Promise<void>}} [opts]
 */
export function telegramClient(token, { fetch: f = globalThis.fetch, wait = sleep } = {}) {
  if (!token || !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim())) {
    throw new Error('Bot anahtarı (TELEGRAM_BOT_TOKEN) eksik ya da biçimi hatalı. GitHub → Settings → Secrets bölümünü kontrol et.');
  }
  const t = token.trim();

  async function call(method, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await f(`${API}/bot${t}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
          signal: AbortSignal.timeout(15000),
        });
      } catch (err) {
        return { ok: false, error: redact(`Telegram'a bağlanılamadı: ${describeError(err)}`, t) };
      }
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* gövde okunamadı */
      }
      if (res.ok && json?.ok) return { ok: true, result: json.result };
      if (res.status === 429 && attempt === 0) {
        const after = Math.min(Number(json?.parameters?.retry_after) || 3, 10);
        await wait(after * 1000);
        continue;
      }
      return { ok: false, status: res.status, error: redact(explain(res.status, json?.description), t) };
    }
    return { ok: false, error: 'Telegram sınırı: çok fazla mesaj' };
  }

  return {
    getMe: () => call('getMe'),
    getUpdates: () => call('getUpdates', { limit: 100, allowed_updates: ['message'] }),
    send: (chatId, text) => call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }),
  };
}

function explain(status, description) {
  if (status === 401) return 'Bot anahtarı geçersiz (Telegram 401). @BotFather\'dan aldığın anahtarı Secret olarak yeniden kaydet.';
  if (status === 403) return 'Bot sana mesaj gönderemiyor (Telegram 403). Telegram\'da botu açıp /start yaz; botu engellediysen engeli kaldır.';
  if (status === 400 && /chat not found/i.test(description || '')) return 'Sohbet bulunamadı (Telegram 400). Telegram kurulum görevini yeniden çalıştır.';
  return `Telegram hatası (${status})`;
}

/**
 * getUpdates sonucundan özel sohbetleri çıkarır: [{ id, firstName }]
 * (Bota /start yazan kişiler.)
 */
export function privateChats(updates) {
  const map = new Map();
  for (const u of updates || []) {
    const chat = u?.message?.chat;
    if (chat?.type === 'private' && Number.isSafeInteger(chat.id)) map.set(chat.id, { id: chat.id, firstName: chat.first_name || '' });
  }
  return [...map.values()];
}
