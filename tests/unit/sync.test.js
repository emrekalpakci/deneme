import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergePortfolios,
  canonical,
  encodeBase64Utf8,
  decodeBase64Utf8,
  githubClient,
  syncPortfolio,
  parseRepo,
  PORTFOLIO_PATH,
} from '../../site/js/core/sync.js';
import { emptyPortfolio } from '../../site/js/core/portfolio.js';

const tx = (id, updatedAt, extra = {}) => ({
  id,
  type: 'buy',
  asset: 'gram-altin',
  date: '2026-10-01',
  qty: '1',
  amountTry: '5000',
  feeTry: '0',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt,
  ...extra,
});
const pf = (txs, settings) => ({ ...emptyPortfolio(), updatedAt: '2026-10-01T10:00:00Z', tx: txs, ...(settings ? { settings } : {}) });

test('Türkçe karakter ve emoji base64 ile kayıpsız gider-gelir', () => {
  const s = 'İşlem: ğüşiöç ĞÜŞİÖÇ ₺ 🔔 '.repeat(5000);
  assert.equal(decodeBase64Utf8(encodeBase64Utf8(s)), s);
  // GitHub base64'ü satırlara böler
  const wrapped = encodeBase64Utf8('Gümüş').replace(/(.{4})/g, '$1\n');
  assert.equal(decodeBase64Utf8(wrapped), 'Gümüş');
});

test('birleştirme: iki cihazın işlemleri birleşir, kayıp olmaz, sıra önemsizdir', () => {
  const a = pf([tx('a', '2026-10-01T10:00:00Z'), tx('b', '2026-10-01T10:00:00Z')]);
  const b = pf([tx('b', '2026-10-01T10:00:00Z'), tx('c', '2026-10-02T10:00:00Z', { date: '2026-10-02' })]);
  const m1 = mergePortfolios(a, b);
  const m2 = mergePortfolios(b, a);
  assert.deepEqual(m1.tx.map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(canonical(m1), canonical(m2));
  assert.equal(canonical(mergePortfolios(m1, m1)), canonical(m1), 'tekrar birleştirmek bir şey değiştirmez');
});

test('birleştirme: yeni düzenleme kazanır; silme işareti korunur, eşit zamanda silme kazanır', () => {
  const local = pf([tx('a', '2026-10-03T00:00:00Z', { qty: '2' }), tx('b', '2026-10-01T00:00:00Z')]);
  const remote = pf([tx('a', '2026-10-02T00:00:00Z', { qty: '3' }), tx('b', '2026-10-04T00:00:00Z', { deleted: true })]);
  const m = mergePortfolios(local, remote);
  assert.equal(m.tx.find((t) => t.id === 'a').qty, '2');
  assert.equal(m.tx.find((t) => t.id === 'b').deleted, true);
  const tie = mergePortfolios(pf([tx('x', '2026-10-05T00:00:00Z')]), pf([tx('x', '2026-10-05T00:00:00Z', { deleted: true })]));
  assert.equal(tie.tx[0].deleted, true);
});

test('birleştirme: hedefler ve bildirim ayarı varlık bazında yeni olan kazanır', () => {
  const local = pf([], { targets: { 'gram-altin': { tp: '20', sl: '8', updatedAt: '2026-10-05T00:00:00Z' } }, alerts: { weekly: false, updatedAt: '2026-10-01T00:00:00Z' } });
  const remote = pf([], {
    targets: { 'gram-altin': { tp: '15', sl: '8', updatedAt: '2026-10-04T00:00:00Z' }, btc: { tp: '40', sl: '20', updatedAt: '2026-10-04T00:00:00Z' } },
    alerts: { weekly: true, updatedAt: '2026-10-02T00:00:00Z' },
  });
  const m = mergePortfolios(local, remote);
  assert.equal(m.settings.targets['gram-altin'].tp, '20');
  assert.equal(m.settings.targets.btc.tp, '40');
  assert.equal(m.settings.alerts.weekly, true);
  assert.equal(mergePortfolios(emptyPortfolio(), null).settings.alerts.weekly, true);
});

test('depo adı: "kullanıcı/depo" ya da GitHub adresi kabul edilir', () => {
  assert.deepEqual(parseRepo('emrekalpakci/yatirim-verilerim'), { owner: 'emrekalpakci', repo: 'yatirim-verilerim' });
  assert.deepEqual(parseRepo(' https://github.com/emrekalpakci/yatirim-verilerim.git/ '), { owner: 'emrekalpakci', repo: 'yatirim-verilerim' });
  assert.equal(parseRepo('yatirim-verilerim'), null);
  assert.equal(parseRepo('a/b/c'), null);
});

// --- Sahte GitHub sunucusu --------------------------------------------------------------

function fakeGithub({ file = null, conflicts = 0, status = null } = {}) {
  const st = { file, sha: file ? 'sha0' : null, puts: 0, conflicts, calls: [] };
  const json = (code, body, headers = {}) => ({ ok: code < 300, status: code, json: async () => body, headers: new Map(Object.entries(headers)) });
  st.fetch = async (url, init = {}) => {
    st.calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization });
    if (status) return json(status, {});
    if (url.endsWith('/repos/o/r')) return json(200, { private: true, permissions: { push: true } }, { 'github-authentication-token-expiration': '2027-10-11 08:00:00 UTC' });
    if (url.endsWith(`/contents/${PORTFOLIO_PATH}`) && (init.method || 'GET') === 'GET') {
      if (!st.file) return json(404, {});
      return json(200, { type: 'file', sha: st.sha, content: encodeBase64Utf8(JSON.stringify(st.file)) });
    }
    if (init.method === 'PUT') {
      st.puts += 1;
      const body = JSON.parse(init.body);
      if (st.conflicts > 0) {
        st.conflicts -= 1;
        // Bu arada başka bir cihaz yazdı.
        st.file = { ...st.file, tx: [...(st.file?.tx || []), tx(`baska${st.conflicts}`, '2026-10-06T00:00:00Z')] };
        st.sha = `sha-x${st.conflicts}`;
        return json(409, {});
      }
      if ((body.sha || null) !== st.sha) return json(409, {});
      st.file = JSON.parse(decodeBase64Utf8(body.content));
      st.sha = `sha${st.puts}`;
      return json(200, { content: { sha: st.sha } });
    }
    return json(500, {});
  };
  st.client = githubClient({ token: 'github_pat_TEST', owner: 'o', repo: 'r', fetch: st.fetch });
  return st;
}

test('eşitleme: depoda dosya yoksa oluşturulur; aynıysa tekrar yazılmaz', async () => {
  const gh = fakeGithub();
  const local = pf([tx('a', '2026-10-01T10:00:00Z')]);
  const r1 = await syncPortfolio({ client: gh.client, local });
  assert.equal(r1.pushed, true);
  assert.equal(gh.puts, 1);
  assert.equal(gh.file.tx.length, 1);
  const r2 = await syncPortfolio({ client: gh.client, local: r1.portfolio });
  assert.equal(r2.pushed, false);
  assert.equal(gh.puts, 1);
  assert.ok(gh.calls.every((c) => c.auth === 'Bearer github_pat_TEST'));
});

test('eşitleme: çakışmada okunur, birleştirilir, yeniden yazılır (en fazla 3 deneme)', async () => {
  const gh = fakeGithub({ file: pf([tx('r', '2026-10-01T10:00:00Z')]), conflicts: 2 });
  const r = await syncPortfolio({ client: gh.client, local: pf([tx('l', '2026-10-01T10:00:00Z')]) });
  assert.equal(r.attempts, 3);
  assert.deepEqual(gh.file.tx.map((t) => t.id).sort(), ['baska0', 'baska1', 'l', 'r']);
  const gh2 = fakeGithub({ file: pf([]), conflicts: 5 });
  await assert.rejects(syncPortfolio({ client: gh2.client, local: pf([tx('l', '2026-10-01T10:00:00Z')]) }), /kaydedilemedi/);
});

test('eşitleme: hatalar sade Türkçe ve token içermez', async () => {
  for (const [status, re] of [
    [401, /Token geçersiz/],
    [403, /izni yok/],
    [404, /Depo bulunamadı/],
    [500, /GitHub hatası \(500\)/],
  ]) {
    const gh = fakeGithub({ status });
    await assert.rejects(syncPortfolio({ client: gh.client, local: emptyPortfolio() }), (err) => re.test(err.message) && !err.message.includes('github_pat_TEST'));
  }
  const offline = githubClient({ token: 't', owner: 'o', repo: 'r', fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.checkRepo(), /bağlanılamadı/);
  const ok = fakeGithub();
  assert.equal((await ok.client.checkRepo()).tokenExpires, '2027-10-11 08:00:00 UTC');
});

test('yedekten yükleme eşitlemeyle uyumlu: yedekte olmayan işlemler silinmiş işaretlenir', async () => {
  const { replaceWithBackup } = await import('../../site/js/ui/portfolio-store.js');
  const current = pf([tx('a', '2026-10-01T00:00:00Z'), tx('b', '2026-10-01T00:00:00Z')]);
  const backup = pf([tx('a', '2026-09-01T00:00:00Z', { qty: '7' }), tx('c', '2026-09-01T00:00:00Z')]);
  const r = replaceWithBackup(current, backup);
  const byId = Object.fromEntries(r.tx.map((t) => [t.id, t]));
  assert.equal(byId.b.deleted, true);
  assert.equal(byId.a.qty, '7');
  // Telefondaki eski hâliyle birleşince yedek kazanır (yeni zaman damgası)
  const merged = mergePortfolios(current, r);
  assert.deepEqual(merged.tx.filter((t) => !t.deleted).map((t) => `${t.id}:${t.qty}`).sort(), ['a:7', 'c:1']);
});
