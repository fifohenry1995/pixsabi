'use strict';
// Run with: npm test (or: node scripts/naijapic-test.js)
// Checks sliding puzzles that borrow a Naija picture (no extra storage), and the admin watermark text.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-naijapic-'));
fs.mkdirSync(path.join(tmp, 'images'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'content', 'puzzles.json'), path.join(tmp, 'puzzles.json'));
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, 'data'), PUZZLES_FILE: path.join(tmp, 'puzzles.json'), IMAGE_DIR: path.join(tmp, 'images'),
  ADS_DIR: path.join(tmp, 'ads'), LOGINBG_DIR: path.join(tmp, 'loginbg'), WORLDBG_DIR: path.join(tmp, 'worldbg'), POPUPS_DIR: path.join(tmp, 'popups'),
  SLIDE_FILE: path.join(tmp, 'slide.json'), SLIDE_DIR: path.join(tmp, 'slide'), WORDSEARCH_FILE: path.join(tmp, 'ws.json'), ADMIN_USER: 'boss',
});
const server = require('../src/app');
const SL = require('../src/slide');
const P = require('../src/puzzles');

const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]).toString('base64');
let base;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };


(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const boss = new Client(), ada = new Client(), anon = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });

  // ---- watermark text ----
  await ada.call('GET', '/api/admin/watermark', null, 404);
  await ada.call('PUT', '/api/admin/watermark', { text: 'x' }, 404);
  assert.strictEqual((await boss.call('GET', '/api/admin/watermark')).text, 'PixSabi');
  const w = await boss.call('PUT', '/api/admin/watermark', { text: '  @sabi\n naija  ' });
  assert.strictEqual(w.text, '@sabi naija');
  assert.strictEqual((await boss.call('PUT', '/api/admin/watermark', { text: 'x'.repeat(80) })).text.length, 30);
  assert.strictEqual((await boss.call('PUT', '/api/admin/watermark', { text: '' })).text, '');
  assert.ok((await boss.call('GET', '/api/admin/watermark')).since > 0);
  assert.ok((await boss.call('POST', '/api/admin/watermark/stamped', {})).stampedAt > 0);
  ok('admin: watermark text is saved, cleaned and admin-only');

  // ---- a sliding puzzle that uses a Naija picture ----
  const naija = P.puzzles.filter((p) => p.world === 'Naija' || p.category === 'Naija').slice(0, 2);
  const [a, b] = naija;
  const pic = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 9)]);
  for (const p of naija) fs.writeFileSync(path.join(process.env.IMAGE_DIR, p.id + '.jpg'), pic);
  await ada.call('POST', '/api/admin/slide', { from: a.id, size: 3 }, 404);
  await boss.call('POST', '/api/admin/slide', { from: 'nosuchpuzzle', size: 3 }, 400);
  let out = await boss.call('POST', '/api/admin/slide', { from: a.id, size: 3 });
  const lv = out.levels[0];
  assert.strictEqual(lv.from, a.id); assert.ok(lv.title.length > 0 && lv.image && !lv.missing);
  assert.ok(!fs.existsSync(SL.fileOf(lv.id)), 'no new picture file is stored');
  await boss.call('POST', '/api/admin/slide', { from: a.id, size: 4 }, 409);
  const res = await fetch(base + lv.image, { headers: { Cookie: ada.cookie } });
  assert.strictEqual(res.status, 200); assert.strictEqual(Buffer.compare(Buffer.from(await res.arrayBuffer()), pic), 0, 'the Naija picture is served');
  assert.strictEqual((await fetch(base + lv.image)).status, 401, 'Naija pictures need a login');
  assert.strictEqual((await ada.call('GET', '/api/sl/state')).puzzle.id, lv.id);
  ok('admin: a sliding level can borrow a Naija picture (nothing new stored, login needed)');

  out = await boss.call('PUT', `/api/admin/slide/${lv.id}`, { title: 'My title', size: 4, fact: 'f' });
  assert.strictEqual(out.levels[0].from, a.id); assert.strictEqual(out.levels[0].size, 4);
  await boss.call('PUT', `/api/admin/slide/${lv.id}`, { title: 'T', size: 3, image: JPEG }, 400);
  ok('editing keeps the Naija picture, and a new upload is refused');

  // the Naija puzzle is renamed: the level follows it. Deleted: the level is skipped (shown as missing).
  if (b) {
    await boss.call('POST', '/api/admin/slide', { from: b.id, size: 3 });
    const list = await boss.call('GET', '/api/admin/puzzles');
    const row = list.puzzles.find((x) => x.id === b.id);
    await boss.call('PUT', `/api/admin/puzzles/${b.id}`, { answer: row.answer + 'Z', category: row.category, clue: row.clue, fact: row.fact });
    const after = (await boss.call('GET', '/api/admin/slide')).levels;
    assert.ok(after.some((l) => l.from === b.id + 'z' && !l.missing), 'the level follows a renamed puzzle');
    await boss.call('DELETE', `/api/admin/puzzles/${b.id}z`);
    assert.ok((await boss.call('GET', '/api/admin/slide')).levels.some((l) => l.from === b.id + 'z' && l.missing), 'a level whose puzzle is gone is marked missing');
    ok('renaming or deleting the Naija puzzle is handled');
  }

  console.log(`\nAll ${passed} Naija-picture checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error('\nNAIJAPIC TEST FAILED:', e.stack || e.message); process.exit(1); });
