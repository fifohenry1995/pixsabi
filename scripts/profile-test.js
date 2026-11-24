'use strict';
// Run with: npm test (or: node scripts/profile-test.js)
// Boots the real server on a random port with a throwaway database and checks
// player descriptions, display pictures and public profiles.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-profile-'));
const server = require('../src/app');
const { flush } = require('../src/db');

let base;
class Client {
  constructor() { this.cookie = ''; }
  headers(extra = {}) { return { ...(this.cookie ? { Cookie: this.cookie } : {}), ...extra }; }
  async call(method, url, body, expectStatus = 200) {
    const res = await fetch(base + url, {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expectStatus, `${method} ${url} -> ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  }
  raw(url) { return fetch(base + url, { headers: this.headers() }); }
}

// A tiny stand-in "JPEG": the right first and last bytes are all the server checks.
const fakeJpeg = (size) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7), Buffer.from([0xff, 0xd9])]);
const asDataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${buf.toString('base64')}`;

let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const ada = new Client();
  const tunde = new Client();
  const guest = new Client();

  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  await tunde.call('POST', '/api/auth/register', { username: 'Tunde', password: 'secret2', email: 'tunde@example.com', adult: true });

  // ---- defaults ----
  const first = await ada.call('GET', '/api/me');
  assert.strictEqual(first.user.bio, '');
  assert.strictEqual(first.user.avatar, null);
  ok('new players start with no description and no photo');

  // ---- description ----
  await guest.call('POST', '/api/profile', { bio: 'hi' }, 401);
  const saved = await ada.call('POST', '/api/profile', { bio: '  I love\n\n jollof   and  suya\t  ' });
  assert.strictEqual(saved.bio, 'I love jollof and suya');
  assert.strictEqual((await ada.call('GET', '/api/me')).user.bio, 'I love jollof and suya');
  await ada.call('POST', '/api/profile', { bio: 'x'.repeat(161) }, 400);
  const edge = await ada.call('POST', '/api/profile', { bio: 'y'.repeat(160) });
  assert.strictEqual(edge.bio.length, 160);
  const emoji = await ada.call('POST', '/api/profile', { bio: '🍚'.repeat(160) });
  assert.strictEqual([...emoji.bio].length, 160);
  await ada.call('POST', '/api/profile', { bio: 'Lagos girl. Jollof is life.' });
  const cleared = await tunde.call('POST', '/api/profile', { bio: '' });
  assert.strictEqual(cleared.bio, '');
  ok('description is cleaned up, limited to 160 characters and login-only');

  // ---- display picture: picked from a fixed set ----
  await guest.call('POST', '/api/profile/avatar', { key: 'm1' }, 401);
  await ada.call('POST', '/api/profile/avatar', { key: 'nonsense' }, 400);
  await ada.call('POST', '/api/profile/avatar', { key: '../x' }, 400);
  await ada.call('POST', '/api/profile/avatar', { image: 'data:image/jpeg;base64,/9j/AAAA' }, 200);   // old upload field is ignored: it just clears the picture
  assert.strictEqual((await ada.call('GET', '/api/me')).user.avatar, null);
  assert.strictEqual((await ada.raw('/avatars/ada.jpg')).status, 404, 'no photo files are made any more');
  ok('uploads are gone; only listed pictures are accepted');

  const up = await ada.call('POST', '/api/profile/avatar', { key: 'a-cool' });
  assert.strictEqual(up.avatar, 'preset:a-cool');
  assert.strictEqual((await ada.call('GET', '/api/me')).user.avatar, 'preset:a-cool');
  const Avatars = require('../src/avatars');
  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'avatars.js'), 'utf8');
  const fakeWin = { NS: {} };
  new Function('window', clientSrc)(fakeWin);
  assert.deepStrictEqual([...fakeWin.NS.avatars.keys].sort(), [...Avatars.KEYS].sort(), 'browser and server picture lists match');
  for (const k of Avatars.KEYS) assert.ok(fakeWin.NS.avatars.svg(k).startsWith('<svg'), k + ' draws');
  assert.strictEqual(fakeWin.NS.avatars.svg('nope'), '');
  ok('picture is saved as a short key, and the browser can draw every picture on the list');

  // ---- public profiles, leaderboard, challenges ----
  const view = await tunde.call('GET', '/api/players/ADA');
  assert.strictEqual(view.player.username, 'Ada');
  assert.strictEqual(view.player.bio, 'Lagos girl. Jollof is life.');
  assert.strictEqual(view.player.avatar, up.avatar);
  assert.strictEqual(view.player.you, false);
  assert.ok(!JSON.stringify(view).includes('passHash'));
  assert.strictEqual((await ada.call('GET', '/api/players/ada')).player.you, true);
  await tunde.call('GET', '/api/players/ghost', null, 404);
  await guest.call('GET', '/api/players/ada', null, 401);
  const lb = await tunde.call('GET', '/api/leaderboard');
  assert.strictEqual(lb.top.find((r) => r.username === 'Ada').avatar, up.avatar);
  assert.strictEqual(lb.top.find((r) => r.username === 'Tunde').avatar, null);
  const ch = await ada.call('POST', '/api/challenges', { opponent: 'tunde' });
  await tunde.call('POST', '/api/challenges/join', { code: ch.id });
  const st = await ada.call('GET', `/api/challenges/${ch.id}`);
  assert.strictEqual(st.players.find((p) => p.you).avatar, up.avatar);
  ok('public profile, leaderboard and challenge standings include bio and photo');

  // ---- remove ----
  const gone = await ada.call('POST', '/api/profile/avatar', { key: null });
  assert.strictEqual(gone.avatar, null);
  assert.strictEqual((await ada.call('GET', '/api/me')).user.avatar, null);
  await ada.call('POST', '/api/profile/avatar', { key: null }); // removing twice is harmless
  ok('picture can be removed');

  console.log(`\nAll ${passed} profile checks passed.`);
  server.close();
  flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('\nPROFILE TEST FAILED:', e.stack || e.message);
  process.exit(1);
});
