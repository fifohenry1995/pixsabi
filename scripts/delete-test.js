'use strict';
// Run with: npm test (or: node scripts/delete-test.js)
// Checks deleting an account: the 3-day wait, cancelling, what is removed, races, the public request page, and admin deletion.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-delete-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.AVATAR_DIR = path.join(tmp, 'avatars');
process.env.ADMIN_USER = 'boss';
process.env.AUTH_LIMIT = '1000';
process.env.PUBLIC_URL = 'https://play.example.com';
process.env.RESEND_API_KEY = 'k'; process.env.MAIL_FROM = 'Sabi <hi@example.com>';

const server = require('../src/app');
const Mailer = require('../src/mailer');
const Del = require('../src/accountDelete');
const { db, sql, chat, orders, inbox, AVATAR_DIR } = require('../src/db');
const sent = [];
Mailer.setTransport(async (p) => { sent.push(p); return 200; });

let base;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reg = (c, name, o) => c.call('POST', '/api/auth/register', { username: name, password: 'secret1', email: name.toLowerCase() + '@example.com', adult: true, ...o });
const DAY = 24 * 3600 * 1000;

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const boss = new Client(), dele = new Client(), friend = new Client(), anon = new Client();
  await reg(boss, 'Boss'); await reg(friend, 'Friend'); await reg(dele, 'Dele', { ref: 'friend' });

  // ---- ask, wait 3 days, cancel ----
  await dele.call('POST', '/api/me/delete', { password: 'wrong', confirm: 'DELETE' }, 401);
  await dele.call('POST', '/api/me/delete', { password: 'secret1', confirm: 'nope' }, 400);
  await boss.call('POST', '/api/me/delete', { password: 'secret1', confirm: 'DELETE' }, 400);
  const before = Date.now();
  const r = await dele.call('POST', '/api/me/delete', { password: 'secret1', confirm: 'delete' });
  assert.ok(r.user.deleteAt >= before + 3 * DAY - 1000 && r.user.deleteAt <= Date.now() + 3 * DAY + 1000, 'removed 3 days later');
  await wait(30);
  assert.ok(sent.some((m) => m.to[0] === 'dele@example.com' && /will be deleted/.test(m.subject)), 'an email tells them');
  assert.strictEqual(Del.sweep(), 0, 'nothing is removed before the 3 days are up');
  assert.ok(db.users.dele);
  await dele.call('GET', '/api/me');                                   // still usable while waiting
  assert.strictEqual((await dele.call('POST', '/api/me/delete/cancel', {})).user.deleteAt, 0);
  assert.strictEqual(Del.sweep(Date.now() + 9 * DAY), 0, 'a cancelled request is never removed');
  ok('3-day wait, can be cancelled, needs password and the word DELETE, admin cannot be deleted this way');

  // ---- what is removed ----
  const d = db.users.dele;
  fs.mkdirSync(AVATAR_DIR, { recursive: true }); fs.writeFileSync(path.join(AVATAR_DIR, 'dele.jpg'), 'x');
  chat.add(d, 'hello everybody'); chat.add(db.users.friend, 'hi dele', 'dele'); chat.add(d, 'a private note', 'friend');
  inbox.add('dele', { kind: 'x', title: 't', body: 'b', url: '#/' });
  orders.create({ ref: 'ORD1', userId: 'dele', pack: 'p', coins: 200, amountKobo: 50000, email: 'dele@example.com' });
  sql.prepare("INSERT INTO quizzes (code, host_id, title, topic, secs, questions, created_at) VALUES ('QZ1', 'dele', 'T', '', 20, '[]', 1)").run();
  sql.prepare("INSERT INTO quiz_plays (code, user_id, started_at) VALUES ('QZ1', 'dele', 1)").run();
  db.challenges.FIN111 = { id: 'FIN111', race: true, status: 'finished', createdAt: Date.now(), endedAt: Date.now(), createdBy: 'dele', winner: 'dele', players: { dele: { username: 'Dele', score: 5, solved: 3 }, friend: { username: 'Friend', score: 2, solved: 1 } } };
  db.challenges.WAIT22 = { id: 'WAIT22', race: true, status: 'waiting', createdAt: Date.now(), createdBy: 'friend', invited: 'dele', players: { friend: { username: 'Friend', score: 0, solved: 0 } } };
  db.users.dele.deleteAt = Date.now() - 1000;
  assert.strictEqual(Del.sweep(), 1);
  assert.strictEqual(db.users.dele, undefined, 'the account is gone');
  await dele.call('GET', '/api/me', null, 401);
  await new Client().call('POST', '/api/auth/login', { username: 'Dele', password: 'secret1' }, 401);
  assert.ok(!fs.existsSync(path.join(AVATAR_DIR, 'dele.jpg')), 'picture file removed');
  assert.strictEqual(sql.prepare("SELECT COUNT(*) n FROM chat WHERE user_id = 'dele' OR to_id = 'dele'").get().n, 0, 'public and private messages removed');
  assert.strictEqual(sql.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = 'dele'").get().n, 0);
  assert.strictEqual(sql.prepare("SELECT COUNT(*) n FROM quizzes WHERE host_id = 'dele'").get().n + sql.prepare("SELECT COUNT(*) n FROM quiz_plays WHERE user_id = 'dele'").get().n, 0, 'quiz data removed');
  const o = orders.get('ORD1'); assert.ok(o && o.email === null && o.user_id === 'deleted' && o.coins === 200, 'payment record kept, without the person');
  const fin = db.challenges.FIN111;
  assert.ok(fin.players['Deleted player'] && fin.players['Deleted player'].username === 'Deleted player' && !fin.players.dele && fin.createdBy === 'Deleted player' && fin.winner === 'Deleted player', 'race history shows "Deleted player"');
  assert.strictEqual(db.challenges.WAIT22.status, 'cancelled', 'a lobby that only invited them is closed');
  assert.ok(!(db.users.friend.invited || []).some((x) => x.id === 'dele'), "removed from the inviter's list");
  assert.ok(sent.some((m) => m.to[0] === 'dele@example.com' && /has been deleted/.test(m.subject)), 'a final email');
  await new Client().call('POST', '/api/auth/register', { username: 'Dele', password: 'secret1', email: 'dele@example.com', adult: true });
  ok('everything of theirs is removed; payment record kept without the person; races show "Deleted player"; the name and email can be used again');

  // ---- a running race holds deletion back ----
  const gone = new Client(); await reg(gone, 'Runner');
  db.challenges.RUN333 = { id: 'RUN333', race: true, status: 'active', startedAt: Date.now(), createdAt: Date.now(), createdBy: 'friend', players: { friend: { username: 'Friend', score: 0, solved: 0 }, runner: { username: 'Runner', score: 0, solved: 0 } } };
  db.users.runner.deleteAt = Date.now() - 1000;
  assert.strictEqual(Del.sweep(), 0); assert.ok(db.users.runner, 'still here while the race runs');
  db.challenges.RUN333.status = 'finished'; db.challenges.RUN333.endedAt = Date.now();
  assert.strictEqual(Del.sweep(), 1); assert.strictEqual(db.users.runner, undefined);
  assert.ok(db.challenges.RUN333.players['Deleted player']);
  ok('a player inside a running race is deleted as soon as the race has ended');

  // ---- public request page, for someone who cannot log in ----
  sent.length = 0;
  const same = (await anon.call('POST', '/api/auth/delete-request', { who: 'friend' })).message;
  await wait(30);
  const mail = sent.find((m) => m.to[0] === 'friend@example.com');
  assert.ok(mail && /#\/delete\//.test(mail.text), 'a confirmation link is emailed');
  assert.strictEqual((await anon.call('POST', '/api/auth/delete-request', { who: 'nobody_here' })).message, same, 'same answer for unknown names');
  await anon.call('POST', '/api/auth/delete-request', { who: '' }, 400);
  assert.ok(!db.users.friend.deleteAt, 'nothing starts until the link is opened');
  const tok = /#\/delete\/([\w.-]+)/.exec(mail.text)[1];
  await anon.call('POST', '/api/auth/delete-confirm', { token: tok + 'x' }, 400);
  const conf = await anon.call('POST', '/api/auth/delete-confirm', { token: tok });
  assert.ok(conf.when && db.users.friend.deleteAt > Date.now() + 2 * DAY);
  const nm = new Client(); await nm.call('POST', '/api/auth/register', { username: 'Nomail', password: 'secret1', email: 'nm@example.com', adult: true });
  db.users.nomail.email = '';
  await anon.call('POST', '/api/auth/delete-request', { who: 'nomail' });
  const adm = await boss.call('GET', '/api/admin/reset-requests');
  assert.ok(adm.items.some((x) => x.username === 'Nomail' && x.outcome === 'delete-no-email'), 'the admin sees requests with no email');
  assert.ok(adm.items.some((x) => x.username === 'Friend' && x.outcome === 'delete-emailed'));
  await anon.call('POST', '/api/auth/delete-request', { who: 'boss' });
  const tokBoss = Del.makeToken(db.users.boss);
  await anon.call('POST', '/api/auth/delete-confirm', { token: tokBoss }, 400);
  assert.ok(!db.users.boss.deleteAt, 'the admin account is never scheduled');
  const page = await fetch(base + '/delete-account'); const html = await page.text();
  assert.ok(page.status === 200 && html.includes('Delete your account') && html.includes('/js/delete-account.js'));
  assert.ok((await (await fetch(base + '/privacy')).text()).includes('/delete-account'));
  ok('public request page: emails a link, tells nobody which accounts exist, admin sees requests with no email, admin account protected');

  // ---- the admin deletes an account ----
  await friend.call('POST', '/api/admin/users/nomail/delete', {}, 404);
  await boss.call('POST', '/api/admin/users/boss/delete', {}, 400);
  await boss.call('POST', '/api/admin/users/nobody/delete', {}, 404);
  assert.strictEqual((await boss.call('POST', '/api/admin/users/nomail/delete', {})).deleted, true);
  assert.strictEqual(db.users.nomail, undefined);
  db.challenges.RUN444 = { id: 'RUN444', race: true, status: 'active', startedAt: Date.now(), createdAt: Date.now(), createdBy: 'boss', players: { boss: { username: 'Boss', score: 0, solved: 0 }, friend: { username: 'Friend', score: 0, solved: 0 } } };
  const w = await boss.call('POST', '/api/admin/users/friend/delete', {});
  assert.deepStrictEqual([w.deleted, w.waiting], [false, true]); assert.ok(db.users.friend);
  db.challenges.RUN444.status = 'finished'; db.challenges.RUN444.endedAt = Date.now();
  assert.strictEqual(Del.sweep(), 1); assert.strictEqual(db.users.friend, undefined);
  ok('the admin can delete an account (waits for a running race); players cannot; admins are protected');

  console.log(`\nAll ${passed} account-deletion checks passed.`);
  server.close();
  require('../src/db').flush();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nDELETE TEST FAILED:', e.stack || e.message); process.exit(1); });
