'use strict';
// Run with: npm test (or: node scripts/compress-test.js)
// Checks that text replies are compressed (Brotli / gzip) and stay correct, and that pictures are left alone.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-compress-'));
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



const http = require('http');
const zlib = require('zlib');
const Compress = require('../src/compress');

function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathname);
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'));

  const plain = await get('/js/app.js');
  assert.strictEqual(plain.status, 200); assert.ok(!plain.headers['content-encoding']); assert.strictEqual(plain.body.length, raw.length);
  assert.ok(String(plain.headers.vary).includes('Accept-Encoding'));

  const br = await get('/js/app.js', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.strictEqual(br.headers['content-encoding'], 'br');
  assert.ok(br.body.length < raw.length * 0.35, `Brotli should shrink the script a lot (${br.body.length} of ${raw.length})`);
  assert.ok(zlib.brotliDecompressSync(br.body).equals(raw), 'Brotli copy is identical after unpacking');
  assert.strictEqual(Number(br.headers['content-length']), br.body.length);

  const gz = await get('/js/app.js', { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(gz.headers['content-encoding'], 'gzip');
  assert.ok(zlib.gunzipSync(gz.body).equals(raw));
  const none = await get('/js/app.js', { 'Accept-Encoding': 'br;q=0, gzip;q=0' });
  assert.ok(!none.headers['content-encoding'], 'q=0 means "not accepted"');
  ok('scripts are sent as Brotli or gzip when the browser accepts it, and plain otherwise');

  // each encoding has its own ETag, and a repeat visit gets a cheap 304
  assert.notStrictEqual(br.headers.etag, gz.headers.etag);
  const again = await get('/js/app.js', { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag });
  assert.strictEqual(again.status, 304);
  const wrongEnc = await get('/js/app.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': br.headers.etag });
  assert.strictEqual(wrongEnc.status, 200, 'a Brotli ETag does not match the gzip copy');
  ok('repeat visits still get "304 not modified"');

  const css = await get('/css/style.css', { 'Accept-Encoding': 'br' });
  assert.strictEqual(css.headers['content-encoding'], 'br');
  const png = await get('/icons/icon-512.png', { 'Accept-Encoding': 'br, gzip' });
  assert.ok(!png.headers['content-encoding'], 'pictures are left alone');
  const home = await get('/', { 'Accept-Encoding': 'gzip' });
  assert.ok(zlib.gunzipSync(home.body).toString().includes('<html'));
  ok('styles and the home page are compressed; pictures are not');

  // JSON replies from the API
  const big = { rows: Array.from({ length: 80 }, (_, i) => ({ id: i, name: 'player' + i, points: i * 7 })) };
  const d = Compress.dynamic({ headers: { 'accept-encoding': 'gzip' } }, 'application/json', Buffer.from(JSON.stringify(big)));
  assert.strictEqual(d.encoding, 'gzip'); assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(d.body)), big);
  const small = Compress.dynamic({ headers: { 'accept-encoding': 'br' } }, 'application/json', Buffer.from('{"ok":true}'));
  assert.strictEqual(small.encoding, null, 'tiny replies are not compressed');
  assert.strictEqual(Compress.dynamic({ headers: {} }, 'application/json', Buffer.alloc(5000, 97)).encoding, null);
  assert.strictEqual(Compress.dynamic({ headers: { 'accept-encoding': 'br' } }, 'image/jpeg', Buffer.alloc(5000, 97)).encoding, null);
  const api = await get('/api/stats', { 'Accept-Encoding': 'br, gzip' });
  assert.strictEqual(api.status, 200);
  JSON.parse((api.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(api.body) : api.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(api.body) : api.body).toString());
  ok('API replies: big ones are compressed and decode to the same data, tiny ones are left alone');

  console.log(`\nAll ${passed} compression checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error('\nCOMPRESS TEST FAILED:', e.stack || e.message); process.exit(1); });
