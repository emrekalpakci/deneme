import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { telegramClient, redact, privateChats } from '../../scripts/lib/telegram.mjs';
import { fetchLivePrices } from '../../scripts/lib/live.mjs';
import { okDatum, unavailable } from '../../site/js/core/datum.js';

const TOKEN = '123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKK';
const resp = (status, body) => ({ ok: status < 300, status, json: async () => body });

test('telegram: mesaj gönderilir; 429 sonrası bir kez beklenip yeniden denenir', async () => {
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    n += 1;
    return n === 1 ? resp(429, { ok: false, parameters: { retry_after: 2 } }) : resp(200, { ok: true, result: { message_id: 1 } });
  };
  const waits = [];
  const bot = telegramClient(TOKEN, { fetch, wait: async (ms) => waits.push(ms) });
  const r = await bot.send(42, 'Gümüş 🔔');
  assert.equal(r.ok, true);
  assert.deepEqual(waits, [2000]);
  assert.equal(calls[1].body.chat_id, 42);
  assert.equal(calls[1].body.text, 'Gümüş 🔔');
  assert.equal(calls[1].body.parse_mode, undefined, 'düz metin: özel karakter kaçışı gerekmez');
});

test('telegram: hata mesajları anahtarı içermez ve ne yapılacağını söyler', async () => {
  const bot401 = telegramClient(TOKEN, { fetch: async () => resp(401, { ok: false, description: `bad ${TOKEN}` }) });
  const r = await bot401.send(1, 'x');
  assert.equal(r.ok, false);
  assert.match(r.error, /Bot anahtarı geçersiz/);
  assert.ok(!r.error.includes(TOKEN));
  const bot403 = telegramClient(TOKEN, { fetch: async () => resp(403, { ok: false }) });
  assert.match((await bot403.send(1, 'x')).error, /\/start/);
  const offline = telegramClient(TOKEN, { fetch: async () => { throw Object.assign(new Error(`connect to https://api.telegram.org/bot${TOKEN}`), { cause: { code: 'ECONNRESET' } }); } });
  const e = await offline.send(1, 'x');
  assert.match(e.error, /ECONNRESET/);
  assert.ok(!e.error.includes(TOKEN));
  assert.equal(redact(`x bot${TOKEN} y`, null), 'x bot*** y');
  assert.throws(() => telegramClient(''), /TELEGRAM_BOT_TOKEN/);
  assert.throws(() => telegramClient('yanlis'), /biçimi hatalı/);
});

test('telegram kurulumu: sadece özel sohbetler, tekrarsız', () => {
  const updates = [
    { message: { chat: { id: 5, type: 'private', first_name: 'Emre' } } },
    { message: { chat: { id: 5, type: 'private', first_name: 'Emre' } } },
    { message: { chat: { id: -100, type: 'group' } } },
    { edited_message: {} },
  ];
  assert.deepEqual(privateChats(updates), [{ id: 5, firstName: 'Emre' }]);
});

test('canlı fiyat: kaynaklar paralel; süre dolunca bitmeyen "yok" sayılır, uydurulmaz', async () => {
  const t = new Date().toISOString();
  const quick = (v) => [{ id: 'hizli', run: async () => ({ datum: okDatum(v, t, 'hızlı'), ms: 1 }) }];
  const never = [{ id: 'yavas', run: () => new Promise(() => {}) }];
  const providers = { metal: (s) => (s === 'XAU' ? quick(4000) : never), crypto: () => quick(80000), fx: () => quick(40) };
  const started = Date.now();
  const { live, sources } = await fetchLivePrices({}, { providers, deadlineMs: 50 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(live.XAU.v, 4000);
  assert.equal(live.XAG.st, 'unavailable');
  assert.match(live.XAG.why, /süre doldu/);
  assert.equal(live.BTC.v, 80000);
  assert.equal(sources.find((s) => s.key === 'XAG').used, null);
});

test('canlı fiyat: kayıtlı fiyattan çok farklı değer ikinci kaynakla doğrulanmadan kabul edilmez', async () => {
  const t = new Date().toISOString();
  const two = (a, b) => [
    { id: 'a', run: async () => ({ datum: okDatum(a, t, 'A'), ms: 1 }) },
    { id: 'b', run: async () => ({ datum: b === null ? unavailable('B', 'yok') : okDatum(b, t, 'B'), ms: 1 }) },
  ];
  const providers = { metal: () => two(6000, null), crypto: () => two(80000, 80100), fx: () => two(40, 40) };
  const { live } = await fetchLivePrices({ XAU: 4000, XAG: 4000, BTC: 50000 }, { providers });
  assert.equal(live.XAU.st, 'unavailable', '%50 sıçrama, ikinci kaynak yok');
  assert.equal(live.BTC.v, 80000, '%60 sıçrama ama ikinci kaynak %2 içinde doğruladı');
});

test('açık depoda gizli bilgi yok; gizli depo şablonları anahtarı sadece Secret olarak kullanır', async () => {
  const root = new URL('../../', import.meta.url).pathname;
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'probe-out', 'data', 'vendor'].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(m?js|ya?ml|json|md|html)$/.test(e.name)) files.push(p);
    }
  }
  await walk(root);
  const SECRET = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|\d{8,10}:AA[A-Za-z0-9_-]{30,})/;
  for (const f of files) {
    if (f.includes('/tests/')) continue;
    assert.doesNotMatch(await readFile(f, 'utf8'), SECRET, f);
  }
  const wf = await readFile(join(root, 'templates/private-repo/.github/workflows/bildirim.yml'), 'utf8');
  assert.match(wf, /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/);
  assert.match(wf, /timeout-minutes: 2/);
  assert.match(wf, /cron: '22,52 \* \* \* \*'/);
  assert.doesNotMatch(wf, /set -x|echo .*secrets|cat .*portfoy/);
});
