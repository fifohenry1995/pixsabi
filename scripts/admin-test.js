'use strict';
// Run with: npm test (or: node scripts/admin-test.js)
// Checks the admin page API against a COPY of your content, so your real puzzles and
// pictures are never touched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-admin-'));
fs.mkdirSync(path.join(tmp, 'images'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'content', 'puzzles.json'), path.join(tmp, 'puzzles.json'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PUZZLES_FILE = path.join(tmp, 'puzzles.json');
process.env.IMAGE_DIR = path.join(tmp, 'images');
process.env.ADS_DIR = path.join(tmp, 'ads');
process.env.LOGINBG_DIR = path.join(tmp, 'loginbg');
process.env.WORLDBG_DIR = path.join(tmp, 'worldbg');
process.env.POPUPS_DIR = path.join(tmp, 'popups');
process.env.ADMIN_USER = 'boss';

const server = require('../src/app');
const P = require('../src/puzzles');
const { db } = require('../src/db');

const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]).toString('base64');
let base;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const img = (name) => path.join(tmp, 'images', name);

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const boss = new Client();
  const ada = new Client();
  const anon = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  const total0 = P.puzzles.length;

  // ---- who can get in ----
  await anon.call('GET', '/api/admin/puzzles', null, 401);
  assert.strictEqual((await ada.call('GET', '/api/admin/status')).admin, false);
  assert.strictEqual((await boss.call('GET', '/api/admin/status')).admin, true);
  await ada.call('GET', '/api/admin/puzzles', null, 404);
  await ada.call('POST', '/api/admin/puzzles', { answer: 'TESTWORD', category: 'Naija', clue: 'c', fact: 'f', image: JPEG }, 404);
  await ada.call('PUT', '/api/admin/puzzles/jollof', { answer: 'JOLLOF', category: 'Naija', clue: 'c', fact: 'f' }, 404);
  await ada.call('DELETE', '/api/admin/puzzles/jollof', {}, 404);
  assert.strictEqual(P.puzzles.length, total0);
  ok('only the named admin can use the admin API; everyone else gets "not found"');

  // ---- add ----
  const list = await boss.call('GET', '/api/admin/puzzles');
  assert.strictEqual(list.puzzles.length, total0);
  assert.ok(list.puzzles[0].answer && list.puzzles[0].clue);
  const good = { answer: 'testword', category: 'Universal', clue: 'Red hibiscus drink', fact: 'Zobo is made from roselle petals.', image: JPEG };
  await boss.call('POST', '/api/admin/puzzles', { ...good, answer: 'ZO' }, 400);
  await boss.call('POST', '/api/admin/puzzles', { ...good, answer: 'TESTWORD1' }, 400);
  await boss.call('POST', '/api/admin/puzzles', { ...good, category: '' }, 400);
  await boss.call('POST', '/api/admin/puzzles', { ...good, category: 'Drinks' }, 400);   // only Naija or Universal
  await boss.call('POST', '/api/admin/puzzles', { ...good, clue: ' ' }, 400);
  await boss.call('POST', '/api/admin/puzzles', { ...good, image: undefined }, 400);                       // a new puzzle needs a picture
  await boss.call('POST', '/api/admin/puzzles', { ...good, image: 'data:image/png;base64,AAAA' }, 400);   // not a jpeg
  await boss.call('POST', '/api/admin/puzzles', { ...good, image: 'data:image/jpeg;base64,' + Buffer.from('not a picture at all, just text'.repeat(20)).toString('base64') }, 400);
  await boss.call('POST', '/api/admin/puzzles', { ...good, answer: 'JOLLOF' }, 409);                      // duplicate
  assert.strictEqual(P.puzzles.length, total0);
  const added = await boss.call('POST', '/api/admin/puzzles', good);
  assert.strictEqual(added.puzzle.answer, 'TESTWORD');
  assert.strictEqual(P.puzzles.length, total0 + 1);
  assert.ok(fs.existsSync(img('testword.jpg')));
  assert.ok(JSON.parse(fs.readFileSync(process.env.PUZZLES_FILE, 'utf8')).some((x) => x.a === 'TESTWORD'));
  assert.ok(fs.readdirSync(path.join(tmp, 'backups')).length >= 1, 'a backup is kept');
  ok('adds a puzzle: checks every field, saves the picture and the list, keeps a backup');

  // ---- live: players see it at once, with no restart ----
  const cats = await ada.call('GET', '/api/categories');
  assert.ok(cats.categories.some((c) => c.name === 'Universal' && c.count === 1));
  const s = await ada.call('GET', '/api/solo/next?category=Universal');
  assert.strictEqual(s.puzzle.length, 8); // TESTWORD has 8 letters
  assert.ok(s.puzzle.image && s.puzzle.image.startsWith('/pic/'));
  assert.ok(!JSON.stringify(s).toLowerCase().includes('testword'), 'the answer must not reach the player');
  const pic = await fetch(base + s.puzzle.image, { headers: { Cookie: ada.cookie } });
  assert.strictEqual(pic.status, 200);
  assert.strictEqual((await pic.arrayBuffer()).byteLength, 604);
  assert.strictEqual((await fetch(base + s.puzzle.image)).status, 401);
  const win = await ada.call('POST', '/api/solo/guess', { id: s.puzzle.id, guess: 'TESTWORD' });
  assert.strictEqual(win.correct, true);
  assert.strictEqual(win.solvedCount, 1);
  ok('a new puzzle is playable straight away, with its picture, and the answer stays hidden');

  // ---- edit and rename ----
  await boss.call('PUT', '/api/admin/puzzles/testword', { answer: 'TESTWORD', category: 'Universal', clue: 'Hibiscus', fact: 'Updated fact.' });
  assert.strictEqual(P.byId.get('testword').clue, 'Hibiscus');
  assert.ok(fs.existsSync(img('testword.jpg')), 'the picture stays when you do not upload a new one');
  await boss.call('PUT', '/api/admin/puzzles/testword', { answer: 'JOLLOF', category: 'Universal', clue: 'c', fact: 'f' }, 409);
  await boss.call('PUT', '/api/admin/puzzles/nothere', { answer: 'TESTWORD', category: 'Universal', clue: 'c', fact: 'f' }, 404);
  await boss.call('PUT', '/api/admin/puzzles/testword', { answer: 'TESTWORDS', category: 'Universal', clue: 'Hibiscus', fact: 'Updated fact.' });
  assert.ok(P.byId.has('testwords') && !P.byId.has('testword'));
  assert.ok(fs.existsSync(img('testwords.jpg')) && !fs.existsSync(img('testword.jpg')), 'the picture file is renamed with the answer');
  assert.ok(db.users.ada.solved.testwords != null && db.users.ada.solved.testword == null, 'players keep credit after a rename');
  assert.strictEqual((await ada.call('GET', '/api/me')).user.solvedCount, 1);
  const newPic = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 9)]).toString('base64');
  await boss.call('PUT', '/api/admin/puzzles/testwords', { answer: 'TESTWORDS', category: 'Universal', clue: 'c', fact: 'f', image: newPic });
  assert.strictEqual(fs.statSync(img('testwords.jpg')).size, 904);
  ok('edits fields, renames the answer (picture and player credit follow), replaces the picture');

  // ---- delete ----
  const ch = await ada.call('POST', '/api/challenges', { category: 'Naija', levels: 20 });
  const inUse = db.challenges[ch.id].puzzleIds[0];
  await boss.call('DELETE', '/api/admin/puzzles/' + inUse, {}, 409);
  assert.ok(P.byId.has(inUse));
  const free = P.puzzles.map((p) => p.id).find((id) => !db.challenges[ch.id].puzzleIds.includes(id) && id !== 'testwords');
  assert.ok(free);
  await boss.call('DELETE', '/api/admin/puzzles/testwords', {});
  assert.ok(!P.byId.has('testwords'));
  assert.strictEqual(P.puzzles.length, total0);
  assert.strictEqual((await ada.call('GET', '/api/me')).user.solvedCount, 0, 'level count follows the puzzles that still exist');
  assert.ok(fs.existsSync(img('testwords.jpg')), 'the picture file is kept');
  await boss.call('DELETE', '/api/admin/puzzles/testwords', {}, 404);
  ok('deletes a puzzle, cleans player records, and refuses while a running challenge uses it');

  // ---- takedown: delete while a player has it open, and remove the picture file too ----
  await boss.call('POST', '/api/admin/puzzles', { answer: 'TAKEDOWN', category: 'Universal', clue: 'c', fact: 'f', image: JPEG });
  const open = await ada.call('GET', '/api/solo/next?category=Universal');
  assert.ok(open.puzzle && open.puzzle.image);
  assert.ok(fs.existsSync(img('takedown.jpg')));
  const gone = await boss.call('DELETE', '/api/admin/puzzles/takedown', { deleteFile: true });
  assert.strictEqual(gone.fileDeleted, true);
  assert.ok(!fs.existsSync(img('takedown.jpg')), 'the picture file is removed from the server');
  assert.strictEqual((await fetch(base + open.puzzle.image, { headers: { Cookie: ada.cookie } })).status, 404, 'the picture URL stops working at once');
  const late = await ada.call('POST', '/api/solo/guess', { id: open.puzzle.id, guess: 'TAKEDOWN' }, 404);
  assert.ok(/could not find that puzzle/i.test(late.error), 'a player who still has it open gets a clear message');
  ok('takedown: the puzzle and its picture file vanish at once, even for a player who has it open');

  // ---- adverts ----
  // login background pictures
  assert.deepStrictEqual((await anon.call('GET', '/api/loginbg')).pictures, [], 'no login backgrounds until the admin adds one');
  await ada.call('PUT', '/api/admin/loginbg/1', { image: JPEG }, 404);
  await boss.call('PUT', '/api/admin/loginbg/9', { image: JPEG }, 404);
  await boss.call('PUT', '/api/admin/loginbg/1', {}, 400);
  await boss.call('PUT', '/api/admin/loginbg/1', { image: 'data:image/png;base64,AAAA' }, 400);
  const bgs = (await boss.call('PUT', '/api/admin/loginbg/2', { image: JPEG })).pictures;
  assert.strictEqual(bgs.length, 1);
  assert.strictEqual((await anon.call('GET', '/api/loginbg')).pictures.length, 1);
  assert.strictEqual((await fetch(base + bgs[0].image)).status, 200);
  assert.strictEqual((await fetch(base + '/bg/3')).status, 404);
  await ada.call('DELETE', '/api/admin/loginbg/2', {}, 404);
  assert.strictEqual((await boss.call('DELETE', '/api/admin/loginbg/2', {})).pictures.length, 0);
  // game card photos on the home screen
  assert.deepStrictEqual((await anon.call('GET', '/api/worldbg')).pictures, {}, 'no card photos until the admin adds one');
  await ada.call('PUT', '/api/admin/worldbg/naija', { image: JPEG }, 404);
  await boss.call('PUT', '/api/admin/worldbg/chess', { image: JPEG }, 404);
  await boss.call('PUT', '/api/admin/worldbg/naija', {}, 400);
  const wb = (await boss.call('PUT', '/api/admin/worldbg/wordsearch', { image: JPEG })).pictures;
  assert.ok(wb.wordsearch && !wb.naija);
  assert.strictEqual((await fetch(base + wb.wordsearch)).status, 200);
  assert.strictEqual((await fetch(base + '/wbg/naija')).status, 404);
  await ada.call('DELETE', '/api/admin/worldbg/wordsearch', {}, 404);
  assert.deepStrictEqual((await boss.call('DELETE', '/api/admin/worldbg/wordsearch', {})).pictures, {});
  assert.deepStrictEqual((await anon.call('GET', '/api/ads')).ads, [], 'no adverts until the admin adds one');
  await ada.call('GET', '/api/admin/ads', null, 404);
  await ada.call('PUT', '/api/admin/ads/1', { image: JPEG, link: '' }, 404);
  await ada.call('DELETE', '/api/admin/ads/1', {}, 404);
  await boss.call('PUT', '/api/admin/ads/1', { link: '' }, 400);                                                   // first time needs a picture
  await boss.call('PUT', '/api/admin/ads/7', { image: JPEG }, 404);                                                // only slots 1 to 6
  await boss.call('PUT', '/api/admin/ads/1', { image: JPEG, link: 'javascript:alert(1)' }, 400);                  // unsafe link refused
  await boss.call('PUT', '/api/admin/ads/1', { image: 'data:image/png;base64,AAAA', link: '' }, 400);
  const a1 = await boss.call('PUT', '/api/admin/ads/1', { image: JPEG, link: 'https://example.com/shop', alt: 'Shop' });
  assert.strictEqual(a1.ads.length, 1);
  const pub = (await anon.call('GET', '/api/ads')).ads;                                                            // public: players need no login
  assert.strictEqual(pub.length, 1);
  assert.strictEqual(pub[0].link, 'https://example.com/shop');
  assert.ok(pub[0].image.startsWith('/ad/1?v='));
  const adPic = await fetch(base + pub[0].image);
  assert.strictEqual(adPic.status, 200);
  assert.strictEqual(adPic.headers.get('content-type'), 'image/jpeg');
  assert.strictEqual((await fetch(base + '/ad/3')).status, 404);
  assert.strictEqual((await fetch(base + '/ad/2')).status, 404);                                                   // empty slot
  await boss.call('PUT', '/api/admin/ads/1', { link: '', alt: 'Shop 2' });                                         // edit text, keep the picture
  assert.strictEqual((await anon.call('GET', '/api/ads')).ads[0].link, '');
  await boss.call('PUT', '/api/admin/ads/2', { image: JPEG, link: 'http://example.org' });
  assert.strictEqual((await anon.call('GET', '/api/ads')).ads.length, 2);
  await boss.call('PUT', '/api/admin/ads/6', { image: JPEG, link: '' });                                           // right side
  assert.strictEqual((await fetch(base + '/ad/6')).status, 200, 'right-side pictures are served too');
  const sides = (await anon.call('GET', '/api/ads')).ads.map((a) => `${a.slot}:${a.side}`);
  assert.deepStrictEqual(sides, ['1:left', '2:left', '6:right']);
  await boss.call('DELETE', '/api/admin/ads/6', {});
  await boss.call('DELETE', '/api/admin/ads/1', {});
  assert.deepStrictEqual((await anon.call('GET', '/api/ads')).ads.map((a) => a.slot), [2]);
  // an animated GIF can be an advert too
  const AD_GIF = 'data:image/gif;base64,' + Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(300, 1)]).toString('base64');
  await boss.call('PUT', '/api/admin/ads/5', { image: 'data:image/gif;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', link: '' }, 400);   // not a real GIF
  const gifAds = (await boss.call('PUT', '/api/admin/ads/5', { image: AD_GIF, link: '' })).ads;
  assert.strictEqual(gifAds.find((a) => a.slot === 5).gif, true);
  const gr = await fetch(base + '/ad/5');
  assert.strictEqual(gr.headers.get('content-type'), 'image/gif');
  await boss.call('PUT', '/api/admin/ads/5', { image: JPEG, link: '' });                                           // replacing it with a JPEG
  assert.strictEqual((await fetch(base + '/ad/5')).headers.get('content-type'), 'image/jpeg');
  await boss.call('DELETE', '/api/admin/ads/5', {});
  assert.strictEqual((await fetch(base + '/ad/5')).status, 404);
  assert.strictEqual((await fetch(base + '/ad/1')).status, 404);
  ok('adverts: admin-only changes, picture and link checks, public display, replace and remove');

  // ---- pop-up adverts ----
  const fake = (mime, head, size = 1000) => `data:${mime};base64,` + Buffer.concat([Buffer.from(head, 'latin1'), Buffer.alloc(size, 5)]).toString('base64');
  const PNG = fake('image/png', '\x89PNG\r\n\x1a\n');
  const GIF = fake('image/gif', 'GIF89a');
  const MP4 = fake('video/mp4', '\x00\x00\x00\x18ftypmp42', 3000);
  const WEBM = fake('video/webm', '\x1a\x45\xdf\xa3');
  const pp0 = await anon.call('GET', '/api/popups');
  assert.strictEqual(pp0.enabled, false);
  assert.deepStrictEqual(pp0.items, []);
  await ada.call('GET', '/api/admin/popups', null, 404);
  await ada.call('POST', '/api/admin/popups', { file: PNG }, 404);
  await ada.call('PUT', '/api/admin/popups/settings', { enabled: true, every: 5, closeAfter: 3 }, 404);
  await boss.call('POST', '/api/admin/popups', { file: 'data:text/html;base64,PGI+aGk8L2I+' }, 400);                  // not an allowed type
  await boss.call('POST', '/api/admin/popups', { file: fake('image/png', 'this is not a png at all') }, 400);          // wrong bytes for the type
  await boss.call('POST', '/api/admin/popups', { file: fake('video/mp4', 'nothing', 100) }, 400);                      // too small / not mp4
  await boss.call('POST', '/api/admin/popups', { file: fake('image/gif', 'GIF89a', 2_600_000) }, 413);                // GIF over 2.5 MB
  await boss.call('POST', '/api/admin/popups', { file: fake('video/mp4', '\x00\x00\x00\x18ftypmp42', 4_100_000) }, 413); // video over 4 MB
  await boss.call('POST', '/api/admin/popups', { file: PNG, link: 'javascript:alert(1)' }, 400);
  let st = await boss.call('POST', '/api/admin/popups', { file: PNG, title: 'Shop', link: 'https://example.com' });
  await boss.call('POST', '/api/admin/popups', { file: GIF, title: 'Gif' });
  st = await boss.call('POST', '/api/admin/popups', { file: MP4, title: 'Video' });
  st = await boss.call('POST', '/api/admin/popups', { file: WEBM, title: 'Webm', active: false });
  assert.deepStrictEqual(st.items.map((i) => i.kind), ['image', 'gif', 'video', 'video']);
  assert.ok(fs.readdirSync(path.join(tmp, 'popups')).filter((f) => !f.endsWith('.json')).length === 4);
  // switched on by default every 10 levels; the inactive one is hidden from players
  let pp = await anon.call('GET', '/api/popups');
  assert.strictEqual(pp.enabled, true);
  assert.strictEqual(pp.every, 10);
  assert.deepStrictEqual(pp.items.map((i) => i.kind), ['image', 'gif', 'video']);
  assert.ok(!JSON.stringify(pp).includes('"active"'));
  // files are public and videos support Range requests (phones need that to play them)
  const vid = pp.items[2];
  const full = await fetch(base + vid.url);
  assert.strictEqual(full.status, 200);
  assert.strictEqual(full.headers.get('content-type'), 'video/mp4');
  assert.strictEqual(full.headers.get('accept-ranges'), 'bytes');
  const part = await fetch(base + vid.url, { headers: { Range: 'bytes=0-9' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers.get('content-range'), `bytes 0-9/${(await full.arrayBuffer()).byteLength}`);
  assert.strictEqual((await part.arrayBuffer()).byteLength, 10);
  const tail = await fetch(base + vid.url, { headers: { Range: 'bytes=-5' } });
  assert.strictEqual(tail.status, 206);
  assert.strictEqual((await tail.arrayBuffer()).byteLength, 5);
  assert.strictEqual((await fetch(base + vid.url, { headers: { Range: 'bytes=99999-' } })).status, 416);
  assert.strictEqual((await fetch(base + '/popup/0000000000')).status, 404);
  assert.strictEqual((await fetch(base + '/popup/../../etc/passwd')).status, 404);
  // settings
  await boss.call('PUT', '/api/admin/popups/settings', { enabled: true, every: 0, closeAfter: 3 }, 400);
  await boss.call('PUT', '/api/admin/popups/settings', { enabled: true, every: 10, closeAfter: 99 }, 400);
  await boss.call('PUT', '/api/admin/popups/settings', { enabled: true, every: 5, closeAfter: 0 });
  pp = await anon.call('GET', '/api/popups');
  assert.strictEqual(pp.every, 5);
  assert.strictEqual(pp.closeAfter, 0);
  // edit, switch off, delete
  const firstId = pp.items[0].id;
  await boss.call('PUT', '/api/admin/popups/' + firstId, { title: 'New', link: '', active: false });
  assert.strictEqual((await anon.call('GET', '/api/popups')).items.length, 2);
  await boss.call('PUT', '/api/admin/popups/settings', { enabled: false, every: 5, closeAfter: 0 });
  assert.deepStrictEqual((await anon.call('GET', '/api/popups')).items, []);
  await boss.call('DELETE', '/api/admin/popups/' + firstId, {});
  assert.strictEqual((await fetch(base + '/popup/' + firstId)).status, 404);
  await boss.call('DELETE', '/api/admin/popups/' + firstId, {}, 404);
  for (const i of (await boss.call('GET', '/api/admin/popups')).items) await boss.call('DELETE', '/api/admin/popups/' + i.id, {});
  for (let i = 0; i < 10; i++) await boss.call('POST', '/api/admin/popups', { file: PNG });
  await boss.call('POST', '/api/admin/popups', { file: PNG }, 400);                                                    // at most 10
  for (const i of (await boss.call('GET', '/api/admin/popups')).items) await boss.call('DELETE', '/api/admin/popups/' + i.id, {});
  ok('pop-up adverts: admin-only, strict file checks, public listing, video Range support, settings, delete');

  // ---- the game still works after all that ----
  const again = await ada.call('GET', '/api/solo/next');
  assert.ok(again.puzzle || again.done);
  await ada.call('GET', '/api/daily');
  ok('solo and daily still work after changes');

  console.log(`\nAll ${passed} admin checks passed.`);
  server.close();
  require('../src/db').flush();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('\nADMIN TEST FAILED:', e.message);
  process.exit(1);
});
