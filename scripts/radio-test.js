'use strict';
// PixSabi Radio: upload, live position, replacing the theme song, and the admin rules. Uses a real server and, if available, a real browser.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), net = require('net');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-radio-'));
const DATA = path.join(tmp, 'data');
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let port, child, passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const env = () => { const e = { ...process.env, DATA_DIR: DATA, ADMIN_USER: 'boss', PORT: String(port) }; for (const k of ['CONTENT_DIR','COMMENTARY_DIR','RADIO_DIR','PUZZLES_FILE','WORDSEARCH_FILE','IMAGE_DIR','ADS_DIR','POPUPS_DIR','LOGINBG_DIR','WORLDBG_DIR','SLIDE_FILE','SLIDE_DIR','SITE_FILE','ADMIN_FILE']) delete e[k]; return e; };
const start = () => new Promise((resolve, reject) => {
  child = spawn(process.execPath, ['src/server.js'], { cwd: root, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; const on = (d) => { out += d; if (out.includes('PixSabi is live')) resolve(); };
  child.stdout.on('data', on); child.stderr.on('data', on);
  setTimeout(() => reject(new Error('server did not start: ' + out)), 15000);
});
const base = () => `http://127.0.0.1:${port}`;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base() + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}
// a real 8-bit mono WAV, 8000 Hz, a quiet tone
function wav(seconds) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(8 * Math.sin(i / 10));
  return b;
}
const asData = (b) => 'data:audio/wav;base64,' + b.toString('base64');
// the audio goes up as the raw file; details are in headers
async function upload(client, buf, { duration = 10, title = '', type = 'application/octet-stream' } = {}) {
  const res = await fetch(base() + '/api/admin/radio/upload', { method: 'POST', headers: { 'Content-Type': type, Cookie: client.cookie, 'X-Duration': String(duration), 'X-Title': encodeURIComponent(title) }, body: buf });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  port = await freePort(); await start();
  const boss = new Client(), ada = new Client(), anon = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });

  assert.strictEqual((await anon.call('GET', '/api/radio')).on, false, 'nothing on air at first (anyone can ask)');
  await anon.call('GET', '/api/admin/radio', null, 401);
  await ada.call('GET', '/api/admin/radio', null, 404);
  assert.strictEqual((await upload(ada, wav(10))).status, 404);
  assert.strictEqual((await upload(anon, wav(10))).status, 401);
  await ada.call('DELETE', '/api/admin/radio', null, 404);
  ok('only the admin controls the radio');

  assert.strictEqual((await upload(boss, Buffer.from('this is plain text, not sound '.repeat(300)))).status, 400);
  assert.strictEqual((await upload(boss, wav(10), { duration: 0 })).status, 400);
  assert.strictEqual((await upload(boss, wav(10), { duration: 99999 })).status, 400);
  assert.strictEqual((await upload(boss, Buffer.alloc(100))).status, 400);
  assert.strictEqual((await upload(boss, wav(10), { type: 'application/json' })).status, 415);
  assert.deepStrictEqual(fs.existsSync(path.join(DATA, 'content', 'radio')) ? fs.readdirSync(path.join(DATA, 'content', 'radio')).filter((x) => x.endsWith('.tmp')) : [], [], 'no half-written file left behind');
  ok('fake, empty and unreadable files refused');

  const t0 = Date.now();
  const upr = await upload(boss, wav(10), { duration: 10, title: 'Friday news' }); assert.strictEqual(upr.status, 200); const up = upr.data;
  assert.ok(up.radio && up.radio.title === 'Friday news' && up.radio.ext === 'wav' && up.radio.duration === 10);
  const pub = await anon.call('GET', '/api/radio');
  assert.ok(pub.on && pub.title === 'Friday news' && pub.duration === 10 && pub.url === up.radio.url);
  assert.ok(pub.startedAt >= t0 - 5 && Math.abs(pub.now - Date.now()) < 5000, 'start time and server clock are given');
  const f = await fetch(base() + pub.url);
  assert.strictEqual(f.status, 200); assert.strictEqual(f.headers.get('content-type'), 'audio/wav');
  const r2 = await fetch(base() + pub.url, { headers: { Range: 'bytes=100-199' } });
  assert.strictEqual(r2.status, 206); assert.strictEqual((await r2.arrayBuffer()).byteLength, 100);
  ok('audio goes on air, public, with the start time and the server clock');

  const again = (await upload(boss, wav(12), { duration: 12, title: 'Saturday' })).data;
  assert.notStrictEqual(again.radio.id, up.radio.id);
  assert.strictEqual((await fetch(base() + pub.url)).status, 404, 'the old audio is gone');
  assert.strictEqual(fs.readdirSync(path.join(DATA, 'content', 'radio')).filter((x) => /\.wav$/.test(x)).length, 1);
  ok('a new upload replaces the old one');

  const before = (await anon.call('GET', '/api/radio')).startedAt;
  await new Promise((r) => setTimeout(r, 30));
  await boss.call('PUT', '/api/admin/radio', { restart: true });
  assert.ok((await anon.call('GET', '/api/radio')).startedAt > before, 'restart moves the start time');
  await boss.call('PUT', '/api/admin/radio', { active: false, title: 'Off' });
  const off = await anon.call('GET', '/api/radio');
  assert.strictEqual(off.on, false);
  assert.strictEqual((await fetch(base() + again.radio.url)).status, 404);
  await boss.call('PUT', '/api/admin/radio', { active: true });
  assert.strictEqual((await anon.call('GET', '/api/radio')).on, true);
  ok('restart, switch off and back on');

  // a long audio: well over the old 8 MB limit goes through
  const big = wav(1); const bigBuf = Buffer.concat([big.subarray(0, 44), Buffer.alloc(12_000_000, 128)]);
  bigBuf.writeUInt32LE(12_000_000, 40);
  const bigUp = await upload(boss, bigBuf, { duration: 1500, title: 'Long one' });
  assert.strictEqual(bigUp.status, 200, JSON.stringify(bigUp.data)); assert.ok(bigUp.data.radio.bytes > 12_000_000);
  const rr = await fetch(base() + bigUp.data.radio.url, { headers: { Range: 'bytes=11000000-11000099' } });
  assert.strictEqual(rr.status, 206);
  ok('a 12 MB audio goes up as a raw file');

  // the browser: the sound button plays the radio at the live place
  let chromium; try { ({ chromium } = require('playwright')); } catch { chromium = null; }
  if (chromium) {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(base() + '/');
    await page.waitForFunction(() => window.NS && NS.music && NS.music.radioInfo().on, null, { timeout: 8000 });
    assert.ok((await page.evaluate(() => NS.music.name())).startsWith('PixSabi Radio'));
    await page.evaluate(() => NS.music.setOn(true));
    await page.waitForFunction(() => NS.music.stats().radio, null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => NS.music.stats());
    assert.strictEqual(st.running, true); assert.strictEqual(st.scheduled, 0, 'the beat is not playing');
    const info = await boss.call('GET', '/api/radio');
    const expected = (((Date.now() + (info.now - Date.now()) - info.startedAt) / 1000) % info.duration);
    const got = st.radioTime;
    const gap = Math.min(Math.abs(got - expected), info.duration - Math.abs(got - expected));
    assert.ok(gap < 4, `joins the live place: got ${got}, expected ${expected}`);
    // the announcer talks: the radio pauses, then comes back at the live place
    await page.evaluate(() => NS.music.hold(true));
    assert.strictEqual(await page.evaluate(() => NS.music.stats().radioPaused), true, 'radio paused while the announcer speaks');
    await page.waitForTimeout(1500);
    await page.evaluate(() => NS.music.hold(false));
    await page.waitForTimeout(600);
    const st2 = await page.evaluate(() => NS.music.stats());
    assert.strictEqual(st2.radioPaused, false, 'radio plays again');
    const info2 = await boss.call('GET', '/api/radio');
    const exp2 = ((Date.now() - info2.startedAt) / 1000) % info2.duration;
    const gap2 = Math.min(Math.abs(st2.radioTime - exp2), info2.duration - Math.abs(st2.radioTime - exp2));
    assert.ok(gap2 < 4, `back at the live place: got ${st2.radioTime}, expected ${exp2}`);
    await page.evaluate(() => NS.music.setOn(false));
    assert.strictEqual((await page.evaluate(() => NS.music.stats())).radio, false);
    await boss.call('DELETE', '/api/admin/radio');
    await page.evaluate(() => NS.music.setOn(true));
    await page.waitForFunction(() => NS.music.stats().scheduled > 0, null, { timeout: 8000 });
    assert.strictEqual((await page.evaluate(() => NS.music.stats())).radio, false, 'theme beat again once the radio is deleted');
    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    await browser.close();
    ok('the sound button plays the radio at the live place, and the theme beat returns when it is removed');
  } else console.log('  skip  browser checks (Playwright is not installed here)');

  await boss.call('DELETE', '/api/admin/radio');
  assert.strictEqual((await boss.call('GET', '/api/admin/radio')).radio, null);
  ok('deleted');
  child.kill();
  console.log(`radio-test: ${passed} groups passed`);
  process.exit(0);
})().catch((e) => { console.error(e); try { child.kill(); } catch {} process.exit(1); });
