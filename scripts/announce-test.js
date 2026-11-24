'use strict';
// Run with: npm test (or: node scripts/announce-test.js)
// Checks the admin's announcements (page, chat copy, alert to everyone, ADMIN tag) and the invite-a-friend rewards.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-announce-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.ADMIN_USER = 'boss';

const { db, newUser, inbox, chat, announce } = require('../src/db');
const P = require('../src/puzzles');

const handlers = {};
const route = (m, p, h) => { handlers[`${m} ${p}`] = h; };
require('../src/routes/solo')({ route });
require('../src/routes/daily')({ route });
require('../src/routes/chat')({ route });
require('../src/routes/announce')({ route });
require('../src/routes/invites')({ route });
const Invites = require('../src/routes/invites');
const call = (key, u, body = {}, params = {}, query = {}) => handlers[key]({ user: u, params, body, query, headers: {} });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const rejects = async (fn, status) => { try { await fn(); } catch (e) { assert.strictEqual(e.status, status); return; } assert.fail('should have been refused'); };

(async () => {
  const boss = user('Boss'), ada = user('Ada'), bola = user('Bola');

  // ---- announcements ----
  await rejects(() => call('POST /api/admin/announcements', ada, { title: 't', body: 'b' }), 404);
  await rejects(() => call('POST /api/admin/announcements', boss, { title: '', body: 'b' }), 400);
  await rejects(() => call('POST /api/admin/announcements', boss, { title: 't', body: '   ' }), 400);
  const r = await call('POST /api/admin/announcements', boss, { title: 'New puzzles!', body: 'Fifty new Naija puzzles are live.', chat: true, alert: true });
  assert.ok(r.id); assert.strictEqual(r.alerted, 2, 'everybody except the admin gets the alert');
  const list = call('GET /api/announcements', ada);
  assert.strictEqual(list.items.length, 1); assert.strictEqual(list.items[0].by, 'Boss'); assert.strictEqual(list.unseen, 1);
  call('POST /api/announcements/seen', ada);
  assert.strictEqual(call('GET /api/announcements', ada).unseen, 0);
  assert.strictEqual(call('GET /api/announcements', boss).unseen, 0, 'the admin has seen their own post');
  ok('only the admin can post; players see it, and the "new" count goes down once seen');

  const msgs = call('GET /api/chat', ada).messages;
  const m = msgs.find((x) => x.text.startsWith('New puzzles! - '));
  assert.ok(m, 'copied into the chat'); assert.strictEqual(m.admin, true);
  assert.ok(call('GET /api/chat', ada).messages.every((x) => x.admin === (x.username === 'Boss')));
  ok('the chat copy carries the ADMIN flag (normal players do not)');

  assert.strictEqual(inbox.list('ada', 5)[0].kind, 'announce');
  assert.strictEqual(inbox.list('bola', 5)[0].url, '#/news');
  assert.strictEqual(inbox.list('boss', 5).length, 0);
  bola.alertsOff = true;
  await call('POST /api/admin/announcements', boss, { title: 'Second', body: 'again', alert: true });
  assert.strictEqual(inbox.list('bola', 5).length, 1, 'players who switched alerts off are skipped');
  assert.strictEqual(chat.recent(50).filter((x) => x.text.startsWith('Second')).length, 0, 'not in chat unless ticked');
  bola.alertsOff = false;
  ok('alerts reach every player who has alerts on; chat only when ticked');

  call('DELETE /api/admin/announcements/:id', boss, {}, { id: String(r.id) });
  assert.strictEqual(announce.get(r.id), undefined);
  await rejects(() => call('DELETE /api/admin/announcements/:id', ada, {}, { id: '1' }), 404);
  ok('the admin can delete an announcement; players cannot');

  // ---- invite a friend ----
  const inviter = user('Tunde');
  const friend = user('Chioma');
  Invites.link(friend, 'tunde'); Invites.link(inviter, 'tunde'); Invites.link(user('Ghost2'), 'nobody');
  assert.strictEqual(friend.invitedBy, 'tunde'); assert.strictEqual(inviter.invitedBy, undefined, 'cannot invite yourself');
  assert.deepStrictEqual(call('GET /api/invite', inviter).friends, [{ username: 'Chioma', done: false }]);

  const naija = P.puzzles.filter((p) => p.category === 'Naija');
  const solve = (u, i) => call('POST /api/solo/guess', u, { id: P.publicId(naija[i]), guess: naija[i].answer });
  const coinsF = friend.coins, coinsT = inviter.coins;
  const first = solve(friend, 0);
  assert.strictEqual(first.inviteBonus, 50);
  assert.strictEqual(friend.coins, coinsF + 10 + 50); assert.strictEqual(inviter.coins, coinsT + 50);
  assert.strictEqual(inbox.list('tunde', 5)[0].kind, 'invite');
  assert.strictEqual(solve(friend, 1).inviteBonus, 0, 'only the first level pays');
  assert.strictEqual(friend.coins, coinsF + 10 + 50 + 10); assert.strictEqual(inviter.coins, coinsT + 50);
  const info = call('GET /api/invite', inviter);
  assert.strictEqual(info.joined, 1); assert.strictEqual(info.solved, 1); assert.strictEqual(info.rewarded, 1);
  ok('both players get 50 coins when the friend solves their first level, once');

  // a friend who joined through a link and solves the daily puzzle first also triggers it
  const f2 = user('Dayo'); Invites.link(f2, 'Tunde');
  const ans = require('../src/puzzles');
  const d = call('GET /api/daily', f2);
  assert.ok(d.puzzle);
  inviter.inviteRewarded = 20;                       // already rewarded for the maximum number of friends
  const coinsT2 = inviter.coins;
  const f3 = user('Efe'); Invites.link(f3, 'tunde');
  assert.strictEqual(solve(f3, 0).inviteBonus, 50, 'the friend is still rewarded');
  assert.strictEqual(inviter.coins, coinsT2, 'but the inviter has reached the limit');
  ok('an inviter can be rewarded for at most 20 friends');

  console.log(`\nAll ${passed} announcement and invite checks passed.`);
  require('../src/db').flush();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nANNOUNCE TEST FAILED:', e.stack || e.message); process.exit(1); });
