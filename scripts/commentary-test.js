'use strict';
// Contest commentary: admin audio adverts, serving, config, and the announcer's script.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), net = require('net');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-comm-'));
const DATA = path.join(tmp, 'data');
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let port, child, passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const env = () => { const e = { ...process.env, DATA_DIR: DATA, ADMIN_USER: 'boss', PORT: String(port) }; for (const k of ['CONTENT_DIR','COMMENTARY_DIR','PUZZLES_FILE','WORDSEARCH_FILE','IMAGE_DIR','ADS_DIR','POPUPS_DIR','LOGINBG_DIR','WORLDBG_DIR','SLIDE_FILE','SLIDE_DIR','SITE_FILE','ADMIN_FILE']) delete e[k]; return e; };
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
const mp3 = (n) => 'data:audio/mpeg;base64,' + Buffer.concat([Buffer.from('ID3'), Buffer.alloc(n)]).toString('base64');

(async () => {
  // ---- the script (pure text) ----
  const C = require('../public/js/commentary.js').script;
  const snap = { rounds: 5, players: [
    { username: 'ada_99', solved: 3, done: false, title: 'Rising Star', wins: 2, bio: 'I love jollof! Visit http://spam.example now 🔥' },
    { username: 'Bayo', solved: 1, done: false, bio: '' },
    { username: 'Chi', solved: 0, done: false } ] };
  const intro = C.introLines(snap, { hasAds: true, readBios: true });
  assert.ok(intro.startsWith("It's a beautiful day today and this match is between ada 99, Bayo and Chi."), intro);
  assert.ok(intro.includes('Who is going to win this contest?') && intro.includes('ada 99 is leading with 3 levels cleared, followed by Bayo with 1'), intro);
  assert.ok(intro.includes("Let's quickly dive into each player's bio.") && intro.includes('2 race wins') && intro.endsWith('We will be going on a commercial break.'), intro);
  assert.ok(!/http|spam|🔥/.test(intro), 'bio is cleaned');
  assert.ok(!C.introLines(snap, { hasAds: false, readBios: false }).includes('commercial break'));
  assert.ok(!C.introLines(snap, { hasAds: true, readBios: false }).includes('jollof'));
  const back = C.afterBreakLines(snap, { hasAds: true });
  assert.ok(back.startsWith('Welcome back!') && back.includes("It's a tough contest between") && back.includes('Time to show your Sabi Power!'), back);
  assert.ok(C.finalLines({ rounds: 5, winnerName: 'Bayo', players: [{ username: 'Bayo' }, { username: 'ada_99' }, { username: 'Chi' }] }).includes('Bayo wins the contest'));
  assert.ok(C.standing([{ username: 'A', solved: 0 }, { username: 'B', solved: 0 }]).match(/anybody|wide open/));
  assert.ok(C.standing([{ username: 'A', solved: 2 }, { username: 'B', solved: 2 }]).includes('neck and neck'));
  const voices = [{ name: 'Microsoft Zira', lang: 'en-US' }, { name: 'Microsoft David', lang: 'en-US' }, { name: 'Amelie', lang: 'fr-FR' }];
  assert.strictEqual(C.pickVoice(voices).name, 'Microsoft David');
  assert.strictEqual(C.pickVoice(voices, 'Microsoft Zira').name, 'Microsoft Zira');
  assert.ok(C.looksMale(voices[1]) && !C.looksMale(voices[0]));
  ok('announcer script, bios cleaning and voice choice');

  // ---- server ----
  port = await freePort(); await start();
  const boss = new Client(), ada = new Client(), anon = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  await anon.call('GET', '/api/commentary', null, 401);
  await ada.call('GET', '/api/admin/commentary', null, 404);
  await ada.call('POST', '/api/admin/commentary/ads', { file: mp3(5000) }, 404);
  assert.deepStrictEqual(await ada.call('GET', '/api/commentary/ad'), { ad: null }, 'no adverts yet');
  ok('only the admin manages commentary');

  assert.strictEqual((await ada.call('GET', '/api/commentary')).hasAds, false);
  await boss.call('POST', '/api/admin/commentary/ads', { file: 'data:audio/mpeg;base64,' + Buffer.from('not sound at all, just text').toString('base64') }, 400);
  await boss.call('POST', '/api/admin/commentary/ads', { file: mp3(500) }, 400);
  await boss.call('POST', '/api/admin/commentary/ads', { file: mp3(950000) }, 413);
  await boss.call('POST', '/api/admin/commentary/ads', { file: 'data:image/png;base64,AAAA' }, 400);
  ok('bad, tiny and huge files refused');

  const v = await boss.call('POST', '/api/admin/commentary/ads', { file: mp3(6000), label: 'Jollof Ltd', advertiser: 'Jollof', active: true });
  assert.strictEqual(v.ads.length, 1); const ad = v.ads[0];
  assert.strictEqual(ad.ext, 'mp3'); assert.ok(ad.url.startsWith('/audioad/'));
  const f1 = await fetch(base() + ad.url);
  assert.strictEqual(f1.status, 200); assert.strictEqual(f1.headers.get('content-type'), 'audio/mpeg');
  assert.strictEqual((await f1.arrayBuffer()).byteLength, 6003);
  const f2 = await fetch(base() + ad.url, { headers: { Range: 'bytes=0-9' } });
  assert.strictEqual(f2.status, 206); assert.strictEqual((await f2.arrayBuffer()).byteLength, 10);
  assert.strictEqual((await fetch(base() + '/audioad/0000000000')).status, 404);
  ok('audio advert uploaded and served with ranges');

  assert.strictEqual((await ada.call('GET', '/api/commentary')).hasAds, true);
  const pick = (await ada.call('GET', '/api/commentary/ad')).ad; assert.strictEqual(pick.url, ad.url);
  assert.strictEqual((await boss.call('GET', '/api/admin/commentary')).ads[0].plays, 1);
  const s = await boss.call('PUT', '/api/admin/commentary/settings', { breakEvery: 5, readBios: false, enabled: true });
  assert.strictEqual(s.settings.breakEvery, 5);
  await boss.call('PUT', '/api/admin/commentary/settings', { breakEvery: 0 }, 400);
  await boss.call('PUT', '/api/admin/commentary/settings', { breakEvery: 16 }, 400);
  const cfg = await ada.call('GET', '/api/commentary'); assert.strictEqual(cfg.breakEvery, 5); assert.strictEqual(cfg.readBios, false);
  await boss.call('PUT', '/api/admin/commentary/ads/' + ad.id, { active: false });
  assert.strictEqual((await ada.call('GET', '/api/commentary')).hasAds, false);
  assert.strictEqual((await fetch(base() + ad.url)).status, 404);
  ok('settings, plays and switching an advert off');

  await boss.call('DELETE', '/api/admin/commentary/ads/' + ad.id);
  assert.strictEqual((await boss.call('GET', '/api/admin/commentary')).ads.length, 0);
  const left = fs.readdirSync(path.join(DATA, 'content', 'commentary')).filter((x) => /\.mp3$/.test(x));
  assert.strictEqual(left.length, 0, 'file removed');
  ok('advert deleted');

  child.kill();
  console.log(`commentary-test: ${passed} groups passed`);
  process.exit(0);
})().catch((e) => { console.error(e); try { child.kill(); } catch {} process.exit(1); });
