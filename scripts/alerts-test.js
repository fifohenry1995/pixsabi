'use strict';
// Run with: npm test (or: node scripts/alerts-test.js)
// Checks the alerts: the inbox, the "challenged you / race started / race won" events, spam limits,
// the push message encryption (decrypted here exactly like a phone would) and the safety rules for push addresses.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-alerts-'));
const dbm = require('../src/db');
const { db, newUser, pushSubs } = dbm;
const Push = require('../src/push');
const Notify = require('../src/notify');
const P = require('../src/puzzles');

const handlers = {};
const route = (m, p, h) => { handlers[`${m} ${p}`] = h; };
require('../src/routes/challenges')({ route });
require('../src/routes/alerts')({ route });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { params = {}, body = {}, query = {} } = {}) => handlers[key]({ user: u, params, body, query, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const inboxOf = async (u) => call('GET /api/notifications', u);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A pretend phone: makes its own keys, and can open the encrypted push messages.
function phone() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/' + crypto.randomBytes(8).toString('hex'), p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const open = (body) => {
    const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
    const shared = ecdh.computeSecret(asPub);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]), 32));
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    assert.strictEqual(plain[plain.length - 1], 2, 'last-record marker');
    return JSON.parse(plain.subarray(0, plain.length - 1).toString());
  };
  return { sub, open };
}

(async () => {
  const ada = user('Ada'), bola = user('Bola'), chidi = user('Chidi');
  const sentPush = []; // what reached the (pretend) push service
  Push.setTransport(async (endpoint, headers, body) => { sentPush.push({ endpoint, headers, body }); return endpoint.includes('gone') ? 410 : 201; });

  // ---- push building blocks ----
  const ph = phone();
  const msg = { title: 'Hi', body: 'There ✓', url: '#/c/ABC' };
  assert.deepStrictEqual(ph.open(Push.encrypt(ph.sub, JSON.stringify(msg))), msg, 'a phone can open what the server encrypts');
  const hdr = Push.vapidHeader(ph.sub.endpoint);
  const [, t, k] = /^vapid t=(\S+), k=(\S+)$/.exec(hdr);
  const [h64, b64, s64] = t.split('.');
  assert.strictEqual(JSON.parse(Buffer.from(b64, 'base64url')).aud, 'https://fcm.googleapis.com');
  const kb = Buffer.from(k, 'base64url');
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: kb.subarray(1, 33).toString('base64url'), y: kb.subarray(33, 65).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h64}.${b64}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url')), 'the sign-in token is signed with the server key');
  assert.strictEqual(k, Push.publicKey());
  ok('push messages are encrypted the standard way and signed with the server key');

  // ---- who we will send to ----
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.com/x', 'https://user:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'not a url']) {
    assert.strictEqual(Push.endpointOk(bad), false, bad);
  }
  for (const good of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/?token=abc']) assert.strictEqual(Push.endpointOk(good), true, good);
  await fails(400, () => call('POST /api/push/subscribe', ada, { body: { endpoint: 'https://evil.example.com/x', keys: { p256dh: ph.sub.p256dh, auth: ph.sub.auth } } }));
  await fails(400, () => call('POST /api/push/subscribe', ada, { body: { endpoint: ph.sub.endpoint, keys: { p256dh: 'AAAA', auth: ph.sub.auth } } }));
  await fails(400, () => call('POST /api/push/subscribe', ada, { body: { endpoint: ph.sub.endpoint, keys: { p256dh: ph.sub.p256dh, auth: 'AAAA' } } }));
  ok('push goes only to the real push services, and made-up keys are refused');

  // ---- a direct challenge alerts the friend ----
  const sub = (u, p) => call('POST /api/push/subscribe', u, { body: { endpoint: p.sub.endpoint, keys: { p256dh: p.sub.p256dh, auth: p.sub.auth } } });
  await sub(bola, ph);
  assert.strictEqual((await call('GET /api/push/key', bola)).key, Push.publicKey());
  const id = (await call('POST /api/challenges', ada, { body: { opponent: 'bola', levels: 20, category: P.categories()[0].name, stake: 0 } })).id;
  let box = await inboxOf(bola);
  assert.strictEqual(box.unread, 1);
  assert.strictEqual(box.items[0].title, 'Ada challenged you');
  assert.strictEqual(box.items[0].url, '#/join/' + id);
  assert.ok(/20-level race/.test(box.items[0].body));
  await wait(30);
  assert.strictEqual(sentPush.length, 1, 'Bola\'s phone is alerted');
  assert.deepStrictEqual(ph.open(sentPush[0].body).title, 'Ada challenged you');
  assert.strictEqual((await inboxOf(ada)).unread, 0, 'the challenger gets no alert about their own challenge');
  assert.strictEqual((await inboxOf(chidi)).unread, 0, 'other players are not bothered');
  ok('a direct challenge lands in the friend\'s inbox and on their phone, and nobody else\'s');

  // ---- code challenges (no named friend) alert nobody ----
  const before = sentPush.length;
  await call('POST /api/challenges', chidi, { body: { levels: 20, maxPlayers: 4 } });
  await wait(20);
  assert.strictEqual(sentPush.length, before);
  assert.strictEqual((await inboxOf(bola)).unread, 1);
  ok('challenges shared by code alert nobody');

  // ---- spam limits ----
  Notify.reset();
  const spamId = (n) => call('POST /api/challenges', ada, { body: { opponent: 'chidi', levels: 20 } }).catch((e) => e);
  await spamId(); await spamId(); await spamId();
  assert.strictEqual((await inboxOf(chidi)).items.filter((i) => i.kind === 'challenge').length, 1, 'the same person can alert the same friend only once a minute');
  Notify.reset();
  for (let i = 0; i < 40; i++) Notify.notify('chidi', { kind: 'x', from: 'p' + i, title: 't', body: 'b', url: '#/' });
  assert.ok((await inboxOf(chidi)).items.length <= 30, 'inbox is capped');
  assert.ok(db.users.chidi && true);
  ok('spam limits: once a minute per sender, 30 an hour per player, inbox capped at 30');

  // ---- read / settings ----
  Notify.reset();
  box = await inboxOf(chidi);
  assert.ok(box.unread > 0);
  await call('POST /api/notifications/read', chidi, { body: { id: box.items[0].id } });
  assert.strictEqual((await inboxOf(chidi)).unread, box.unread - 1);
  await call('POST /api/notifications/read', chidi, { body: {} });
  assert.strictEqual((await inboxOf(chidi)).unread, 0);
  await fails(400, () => call('POST /api/notifications/settings', chidi, { body: { enabled: 'no' } }));
  await call('POST /api/notifications/settings', bola, { body: { enabled: false } });
  assert.strictEqual(pushSubs.count('bola'), 0, 'switching alerts off forgets the phones');
  const bolaBefore = (await inboxOf(bola)).items.length;
  Notify.reset();
  await call('POST /api/challenges', ada, { body: { opponent: 'bola', levels: 20 } });
  assert.strictEqual((await inboxOf(bola)).items.length, bolaBefore, 'alerts off means no alerts');
  assert.strictEqual((await inboxOf(bola)).enabled, false);
  await sub(bola, ph);
  assert.strictEqual((await inboxOf(bola)).enabled, true, 'turning push on turns alerts on');
  ok('mark as read, switch alerts off and on');

  // ---- race started and race won ----
  Notify.reset();
  const race = (await call('POST /api/challenges', ada, { body: { levels: 20, maxPlayers: 3 } })).id;
  await call('POST /api/challenges/join', bola, { body: { code: race } });
  await call('POST /api/challenges/join', chidi, { body: { code: race } });
  const b0 = (await inboxOf(bola)).items.length, a0 = (await inboxOf(ada)).items.length;
  await call('POST /api/challenges/:id/start', ada, { params: { id: race } });
  assert.strictEqual((await inboxOf(bola)).items[0].title, 'The race has started!');
  assert.strictEqual((await inboxOf(bola)).items.length, b0 + 1);
  assert.strictEqual((await inboxOf(chidi)).items[0].title, 'The race has started!');
  assert.strictEqual((await inboxOf(ada)).items.length, a0, 'the host who pressed Start is not alerted');
  for (let n = 0; n < 20; n++) {
    const s = await call('GET /api/challenges/:id', bola, { params: { id: race } });
    await call('POST /api/challenges/:id/guess', bola, { params: { id: race }, body: { guess: P.fromPublic(s.puzzle.id).answer } });
  }
  const last = (await inboxOf(ada)).items[0];
  assert.strictEqual(last.title, 'Bola won the race');
  assert.strictEqual(last.url, '#/c/' + race);
  assert.strictEqual((await inboxOf(chidi)).items[0].title, 'Bola won the race');
  assert.notStrictEqual((await inboxOf(bola)).items[0].title, 'Bola won the race', 'the winner is not alerted about their own win');
  ok('race start alerts the other players; a win alerts the people who lost');

  // ---- dead phones are forgotten ----
  const dead = phone(); dead.sub.endpoint = 'https://fcm.googleapis.com/fcm/send/gone-' + Date.now();
  await sub(chidi, dead);
  assert.strictEqual(pushSubs.count('chidi'), 1);
  Notify.reset();
  Notify.notify('chidi', { kind: 'test', from: 'z', title: 't', body: 'b', url: '#/' });
  await wait(50);
  assert.strictEqual(pushSubs.count('chidi'), 0, 'a phone the push service says is gone is removed');
  // at most 5 devices per player
  for (let i = 0; i < 7; i++) await sub(chidi, phone());
  assert.ok(pushSubs.count('chidi') <= 5);
  // another player cannot unsubscribe someone else's phone
  const mine = phone(); await sub(ada, mine);
  await call('POST /api/push/unsubscribe', chidi, { body: { endpoint: mine.sub.endpoint } });
  assert.strictEqual(pushSubs.count('ada'), 1);
  await call('POST /api/push/unsubscribe', ada, { body: { endpoint: mine.sub.endpoint } });
  assert.strictEqual(pushSubs.count('ada'), 0);
  ok('dead phones are forgotten, at most 5 devices each, nobody can remove another player\'s phone');

  console.log(`\nAll ${passed} alert checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
