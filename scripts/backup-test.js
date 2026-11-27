'use strict';
// Backup download and restore, against a real server process in a temp folder.
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), assert = require('assert'), net = require('net');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-backup-'));
const DATA = path.join(tmp, 'data');
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let port, child, passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const env = () => { const e = { ...process.env, DATA_DIR: DATA, ADMIN_USER: 'boss', PORT: String(port) }; for (const k of ['CONTENT_DIR','PUZZLES_FILE','WORDSEARCH_FILE','IMAGE_DIR','ADS_DIR','POPUPS_DIR','LOGINBG_DIR','WORLDBG_DIR','SLIDE_FILE','SLIDE_DIR','SITE_FILE','ADMIN_FILE']) delete e[k]; return e; };
function start() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['src/server.js'], { cwd: root, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
    child.exited = new Promise((r) => child.on('exit', (c) => r(c)));
    let out = '';
    const on = (d) => { out += d; if (out.includes('PixSabi is live')) resolve(); };
    child.stdout.on('data', on); child.stderr.on('data', on);
    setTimeout(() => reject(new Error('server did not start: ' + out)), 15000);
  });
}
const base = () => `http://127.0.0.1:${port}`;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200, extra = {}) {
    const res = await fetch(base() + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}), ...extra.headers }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
  async raw(url, body, headers = {}) {
    const res = await fetch(base() + url, { method: 'POST', headers: { Cookie: this.cookie, ...headers }, body });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
}
const entry = (p, buf) => { const j = Buffer.from(JSON.stringify({ p, s: buf.length })); const l = Buffer.alloc(4); l.writeUInt32BE(j.length); return Buffer.concat([l, j, buf]); };
const pack = (entries) => zlib.gzipSync(Buffer.concat([...entries.map(([p, b]) => entry(p, b)), Buffer.alloc(4)]));

(async () => {
  port = await freePort();
  await start();
  const boss = new Client(), ada = new Client(), anon = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  const content = path.join(DATA, 'content');
  assert.ok(fs.existsSync(path.join(content, 'puzzles.json')), 'content seeded on the volume');
  fs.writeFileSync(path.join(content, 'zz-marker.txt'), 'A');
  fs.mkdirSync(path.join(DATA, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'avatars', 'ada.jpg'), 'PHOTO');

  // who can use it
  await anon.call('POST', '/api/admin/backup/start', {}, 401);
  await ada.call('POST', '/api/admin/backup/start', {}, 404);
  await ada.call('GET', '/api/admin/backup', null, 404);
  assert.strictEqual((await ada.raw('/api/admin/restore', Buffer.from('x'), { 'Content-Type': 'application/octet-stream', 'X-Confirm': 'RESTORE' })).status, 404);
  ok('only the admin can back up or restore');

  // download a backup
  const st0 = await boss.call('GET', '/api/admin/backup');
  assert.strictEqual(st0.lastAt, 0); assert.ok(st0.maxMb >= 1);
  const { url } = await boss.call('POST', '/api/admin/backup/start', {});
  assert.strictEqual((await fetch(base() + url)).status, 401);                       // the link alone is not enough: needs the login
  const dl = await fetch(base() + url, { headers: { Cookie: boss.cookie } });
  assert.strictEqual(dl.status, 200);
  assert.ok(/pixsabi-backup-.*\.pxbackup/.test(dl.headers.get('content-disposition')));
  const backup = Buffer.from(await dl.arrayBuffer());
  assert.ok(backup[0] === 0x1f && backup[1] === 0x8b, 'gzip file');
  assert.strictEqual((await fetch(base() + url, { headers: { Cookie: boss.cookie } })).status, 403);   // one use only
  const raw = zlib.gunzipSync(backup);
  assert.ok(raw.includes(Buffer.from('data/pixsabi.db')) && raw.includes(Buffer.from('content/zz-marker.txt')) && raw.includes(Buffer.from('data/avatars/ada.jpg')));
  assert.ok(!raw.includes(Buffer.from('restore-upload')) && !raw.includes(Buffer.from('backup-tmp')));
  assert.ok((await boss.call('GET', '/api/admin/backup')).lastAt > 0);
  ok('backup downloads as one file with the database, photos and content');

  // life goes on after the backup
  const bob = new Client();
  await bob.call('POST', '/api/auth/register', { username: 'Bob', password: 'secret1', email: 'bob@example.com', adult: true });
  fs.writeFileSync(path.join(content, 'zz-marker.txt'), 'B');
  fs.writeFileSync(path.join(content, 'zz-new.txt'), 'new');
  fs.rmSync(path.join(DATA, 'avatars', 'ada.jpg'));

  // refusals leave everything alone
  const H = { 'Content-Type': 'application/octet-stream', 'X-Confirm': 'RESTORE' };
  assert.strictEqual((await boss.raw('/api/admin/restore', backup, { 'Content-Type': 'application/octet-stream' })).status, 400);
  assert.strictEqual((await boss.raw('/api/admin/restore', backup, { 'Content-Type': 'application/json', 'X-Confirm': 'RESTORE' })).status, 415);
  assert.strictEqual((await boss.raw('/api/admin/restore', Buffer.from('this is not a backup'), H)).status, 400);
  assert.strictEqual((await boss.raw('/api/admin/restore', backup.subarray(0, backup.length >> 1), H)).status, 400);
  const evil = pack([['_meta.json', Buffer.from('{"format":1,"app":"pixsabi"}')], ['data/../../evil.txt', Buffer.from('x')]]);
  assert.strictEqual((await boss.raw('/api/admin/restore', evil, H)).status, 400);
  const nodb = pack([['_meta.json', Buffer.from('{"format":1,"app":"pixsabi"}')], ['content/a.txt', Buffer.from('x')]]);
  assert.strictEqual((await boss.raw('/api/admin/restore', nodb, H)).status, 400);
  assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')) && !fs.existsSync(path.join(DATA, 'restore-pending')));
  await bob.call('GET', '/api/me');            // still running, Bob still there
  assert.strictEqual(fs.readFileSync(path.join(content, 'zz-marker.txt'), 'utf8'), 'B');
  ok('wrong, cut-off, unsafe and empty files are refused and change nothing');

  // restore
  const res = await boss.raw('/api/admin/restore', backup, H);
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  assert.strictEqual(res.data.users, 2);
  const code = await child.exited;
  assert.ok(code !== 0, 'the game restarts itself (exit code ' + code + ')');
  ok('restore accepted; the game restarts');
  await start();
  const login = async (u) => { const c = new Client(); const r = await fetch(base() + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'secret1' }) }); return r.status; };
  assert.strictEqual(await login('Ada'), 200);
  assert.strictEqual(await login('Boss'), 200);
  assert.notStrictEqual(await login('Bob'), 200);
  assert.strictEqual(fs.readFileSync(path.join(content, 'zz-marker.txt'), 'utf8'), 'A');
  assert.ok(!fs.existsSync(path.join(content, 'zz-new.txt')));
  assert.strictEqual(fs.readFileSync(path.join(DATA, 'avatars', 'ada.jpg'), 'utf8'), 'PHOTO');
  assert.ok(fs.existsSync(path.join(DATA, 'before-restore', 'data', 'pixsabi.db')), 'the old data is kept in before-restore');
  assert.ok(fs.existsSync(path.join(DATA, 'before-restore', 'data', 'content', 'zz-new.txt')));
  assert.ok(!fs.existsSync(path.join(DATA, 'restore-pending')));
  ok('after the restart: old players and files are back, newer ones are gone, the old state is kept aside');
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nAll ${passed} backup checks passed.`);
})().catch((e) => { console.error(e); try { child.kill(); } catch {} process.exit(1); });
