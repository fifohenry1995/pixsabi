'use strict';
// Run with: npm test (or: node scripts/account-test.js)
// Checks sign-up rules (email, 18+ box), forgot/reset password by email, changing password and email, and the admin's manual reset.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-account-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.ADMIN_USER = 'boss';
process.env.AUTH_LIMIT = '1000'; // the test makes many sign-in style calls from one address
process.env.RESEND_API_KEY = 'test-key';
process.env.MAIL_FROM = 'PixSabi <hello@example.com>';
process.env.PUBLIC_URL = 'https://play.example.com';

const server = require('../src/app');
const Mailer = require('../src/mailer');
const { db } = require('../src/db');

const sent = [];
Mailer.setTransport(async (payload) => { sent.push(payload); return 200; });

let base;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reg = (c, o, expect) => c.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true, ...o }, expect);

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const ada = new Client(), anon = new Client(), boss = new Client(), other = new Client();

  // ---- sign-up needs an email and the 18+ box ----
  await reg(anon, { adult: false }, 400);
  await reg(anon, { adult: undefined }, 400);
  await reg(anon, { adult: 'true' }, 400);
  await reg(anon, { email: '' }, 400);
  await reg(anon, { email: 'not-an-email' }, 400);
  await reg(anon, { email: 'a b@example.com' }, 400);
  assert.strictEqual(db.users.ada, undefined, 'nothing is created when a rule fails');
  const r = await reg(ada, { email: '  Ada@Example.COM ' });
  assert.strictEqual(r.user.email, 'ada@example.com'); assert.strictEqual(r.user.adultConfirmed, true);
  assert.ok(db.users.ada.adultAt > 0);
  await reg(other, { username: 'Bola', email: 'ADA@example.com' }, 409);   // one account per email
  await reg(other, { username: 'Bola', email: 'bola@example.com' });
  ok('an email and the 18+ tick are needed; an email can only be used once');

  // ---- forgot password ----
  await wait(30); sent.length = 0;   // sign-up now also emails a confirmation link; this section looks only at reset emails
  const same = (await anon.call('POST', '/api/auth/forgot', { who: 'ada' })).message;
  await wait(30);
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].to, ['ada@example.com']);
  const link = /https:\/\/play\.example\.com\/#\/reset\/([A-Za-z0-9_-]+)/.exec(sent[0].text);
  assert.ok(link, 'the email holds the reset link');
  assert.ok(sent[0].html.includes(link[0]));
  assert.strictEqual((await anon.call('POST', '/api/auth/forgot', { who: 'nobody_here' })).message, same, 'unknown names get the same answer');
  assert.strictEqual((await anon.call('POST', '/api/auth/forgot', { who: 'nobody@example.com' })).message, same, 'unknown emails get the same answer');
  assert.strictEqual((await anon.call('POST', '/api/auth/forgot', { who: 'ada@example.com' })).message, same);
  await wait(30);
  assert.strictEqual(sent.length, 1, 'only one email every 5 minutes per player');
  await anon.call('POST', '/api/auth/forgot', { who: '' }, 400);
  assert.ok(!fs.readFileSync(path.join(process.env.DATA_DIR, 'naija-sabi.db')).includes(link[1]), 'the link itself is never stored');
  ok('forgot password: emails a link, tells nobody which accounts exist, limits repeats');

  // ---- reset ----
  const token = link[1];
  await anon.call('POST', '/api/auth/reset', { token: 'wrong', password: 'newpass1' }, 400);
  await anon.call('POST', '/api/auth/reset', { token, password: '123' }, 400);
  const before = ada.cookie;
  const res = await anon.call('POST', '/api/auth/reset', { token, password: 'newpass1' });
  assert.strictEqual(res.user.username, 'Ada');
  await anon.call('GET', '/api/me');                                           // the reset also logs them in
  await anon.call('POST', '/api/auth/reset', { token, password: 'again123' }, 400);  // a link works once
  const oldDevice = new Client(); oldDevice.cookie = before;
  await oldDevice.call('GET', '/api/me', null, 401);                           // other devices are logged out
  await new Client().call('POST', '/api/auth/login', { username: 'Ada', password: 'secret1' }, 401);
  await new Client().call('POST', '/api/auth/login', { username: 'Ada', password: 'newpass1' });
  ok('reset: new password works, old one and old sessions stop, the link works once');

  // ---- an expired link ----
  const { resets } = require('../src/db');
  const old = resets.create('ada', -1000);
  await anon.call('POST', '/api/auth/reset', { token: old, password: 'newpass2' }, 400);
  const first = resets.create('ada', 60000), second = resets.create('ada', 60000);
  await anon.call('POST', '/api/auth/reset', { token: first, password: 'newpass2' }, 400);   // asking again cancels the earlier link
  await anon.call('POST', '/api/auth/reset', { token: second, password: 'newpass2' });
  ok('expired links and replaced links are refused');

  // ---- change password / email ----
  const me = new Client();
  await me.call('POST', '/api/auth/login', { username: 'Ada', password: 'newpass2' });
  await me.call('POST', '/api/me/password', { current: 'wrong', next: 'abcdef' }, 401);
  await me.call('POST', '/api/me/password', { current: 'newpass2', next: '1' }, 400);
  await me.call('POST', '/api/me/password', { current: 'newpass2', next: 'abcdef' });
  await me.call('GET', '/api/me');                                             // this device stays logged in
  await new Client().call('POST', '/api/auth/login', { username: 'Ada', password: 'abcdef' });
  await me.call('POST', '/api/me/email', { email: 'new@example.com', password: 'wrong' }, 401);
  await me.call('POST', '/api/me/email', { email: 'bola@example.com', password: 'abcdef' }, 409);
  assert.strictEqual((await me.call('POST', '/api/me/email', { email: 'New@Example.com', password: 'abcdef' })).user.email, 'new@example.com');
  assert.ok(require('../src/db').q.userByEmail('new@example.com'));
  assert.ok(!require('../src/db').q.userByEmail('ada@example.com'), 'the old email is free again');
  ok('changing password and email asks for the current password');

  // ---- players from before the 18+ box ----
  const { newUser } = require('../src/db');
  const legacy = newUser('Legacy', await require('../src/util').hashPassword('oldpass1'));
  db.users[legacy.id] = legacy;
  const lc = new Client();
  const lg = await lc.call('POST', '/api/auth/login', { username: 'Legacy', password: 'oldpass1' });
  assert.strictEqual(lg.user.adultConfirmed, false); assert.strictEqual(lg.user.email, '');
  await lc.call('POST', '/api/me/adult', { adult: false }, 400);
  await lc.call('POST', '/api/me/adult', { adult: true, email: 'bad' }, 400);
  await lc.call('POST', '/api/me/adult', { adult: true, email: 'bola@example.com' }, 409);
  const done = await lc.call('POST', '/api/me/adult', { adult: true, email: 'legacy@example.com' });
  assert.strictEqual(done.user.adultConfirmed, true); assert.strictEqual(done.user.email, 'legacy@example.com');
  ok('older players confirm 18+ once and can add an email');

  // ---- admin helps a player who cannot use email ----
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await me.call('GET', '/api/admin/users/legacy', null, 404);
  await me.call('POST', '/api/admin/users/legacy/reset-password', {}, 404);
  assert.strictEqual((await boss.call('GET', '/api/admin/users/legacy')).user.email, 'legacy@example.com');
  await boss.call('GET', '/api/admin/users/nobody', null, 404);
  const t = await boss.call('POST', '/api/admin/users/legacy/reset-password', {});
  assert.ok(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/.test(t.temporaryPassword), 'easy to type: lowercase and digits, no look-alikes');
  await new Client().call('POST', '/api/auth/login', { username: 'Legacy', password: 'oldpass1' }, 401);
  await new Client().call('POST', '/api/auth/login', { username: 'Legacy', password: t.temporaryPassword });
  await lc.call('GET', '/api/me', null, 401);
  // phones often capitalise or add a space to a pasted password: a temporary password still works
  const cap = t.temporaryPassword[0].toUpperCase() + t.temporaryPassword.slice(1);
  const tl = new Client();
  assert.strictEqual((await tl.call('POST', '/api/auth/login', { username: 'legacy', password: ' ' + cap + ' ' })).user.mustChange, true);
  await tl.call('POST', '/api/me/password', { current: t.temporaryPassword, next: 'brandnew1' });
  assert.strictEqual((await tl.call('GET', '/api/me')).user.mustChange, false, 'choosing their own password clears the reminder');
  await new Client().call('POST', '/api/auth/login', { username: 'legacy', password: t.temporaryPassword.toUpperCase() }, 401);   // once they chose their own, it is exact again
  ok('the admin can give a player a temporary password; only admins can');

  // ---- the admin sees who tapped "Forgot password" ----
  await me.call('GET', '/api/admin/reset-requests', null, 404);
  let rq = await boss.call('GET', '/api/admin/reset-requests');
  const adaReq = rq.items.find((r) => r.username === 'Ada');
  assert.ok(adaReq && adaReq.outcome === 'sent' && !adaReq.done, 'a request with the email sent is listed');
  require('../src/db').db.users.legacy.email = '';                  // a player with no email on file
  await new Client().call('POST', '/api/auth/forgot', { who: 'legacy' });
  rq = await boss.call('GET', '/api/admin/reset-requests');
  const legReq = rq.items.find((r) => r.username === 'Legacy' && !r.done);
  assert.ok(legReq && legReq.outcome === 'no-email', 'no email on file is flagged so the admin can help by hand');
  assert.ok((await boss.call('GET', '/api/admin/status')).resetRequests >= 2, 'the open count is shown to the admin');
  assert.strictEqual((await me.call('GET', '/api/admin/status')).resetRequests, 0, 'players never see the count');
  await boss.call('POST', '/api/admin/users/legacy/reset-password', {});
  rq = await boss.call('GET', '/api/admin/reset-requests');
  assert.ok(rq.items.filter((r) => r.username === 'Legacy').every((r) => r.done), 'giving a temporary password closes their request');
  await boss.call('POST', `/api/admin/reset-requests/${adaReq.id}/done`, {});
  await me.call('POST', `/api/admin/reset-requests/${adaReq.id}/done`, {}, 404);
  await new Client().call('POST', '/api/auth/forgot', { who: 'nobody_here' });
  assert.ok(!(await boss.call('GET', '/api/admin/reset-requests')).items.some((r) => r.username === 'nobody_here'), 'unknown names are not recorded');
  ok('admin sees forgot-password requests (sent / no email), can close them, and players cannot see them');

  // ---- recovery question and account facts for the admin ----
  assert.ok((await new Client().call('GET', '/api/recovery/questions')).questions.length >= 5);
  const rc = new Client();
  await rc.call('POST', '/api/auth/register', { username: 'Recov', password: 'secret1', email: 'recov@example.com', adult: true, recoveryQ: 'mother', recoveryA: 'x' }, 400);
  await rc.call('POST', '/api/auth/register', { username: 'Recov', password: 'secret1', email: 'recov@example.com', adult: true, recoveryQ: 'nonsense', recoveryA: 'Ngozi' }, 400);
  const rr = await rc.call('POST', '/api/auth/register', { username: 'Recov', password: 'secret1', email: 'recov@example.com', adult: true, recoveryQ: 'mother', recoveryA: 'Mama Ngozi' });
  assert.ok(/mother/i.test(rr.user.recoveryQuestion));
  assert.ok(!JSON.stringify(require('../src/db').db.users.recov).toLowerCase().includes('ngozi'), 'the answer itself is never stored');
  await rc.call('POST', '/api/me/recovery', { question: 'meal', answer: 'Jollof', password: 'wrong' }, 401);
  await rc.call('POST', '/api/me/recovery', { question: 'meal', answer: 'ab', password: 'secret1' }, 400);
  await rc.call('POST', '/api/me/recovery', { question: 'mother', answer: 'Mama Ngozi', password: 'secret1' });
  assert.strictEqual((await boss.call('POST', '/api/admin/users/recov/check-recovery', { answer: '  MAMA   ngozi! ' })).match, true, 'capitals, spaces and punctuation do not matter');
  assert.strictEqual((await boss.call('POST', '/api/admin/users/recov/check-recovery', { answer: 'Ada' })).match, false);
  await me.call('POST', '/api/admin/users/recov/check-recovery', { answer: 'Mama Ngozi' }, 404);
  const facts = (await boss.call('GET', '/api/admin/users/recov')).user;
  assert.ok(facts.joined && facts.levels && 'purchases' in facts && /mother/i.test(facts.recoveryQuestion) && facts.email === 'recov@example.com');
  assert.ok(!JSON.stringify(facts).includes('Ngozi'), 'the admin never sees the answer');
  await rc.call('POST', '/api/auth/login', { username: 'Recov', password: 'secret1' });
  assert.ok((await boss.call('GET', '/api/admin/users/recov')).user.lastLogin > 0, 'last login is recorded');
  await new Client().call('POST', '/api/auth/forgot', { who: 'recov' });
  const rqs = await boss.call('GET', '/api/admin/reset-requests');
  const mine = rqs.items.find((r) => r.username === 'Recov' && !r.done);
  assert.ok(mine && mine.facts && mine.facts.recoveryQuestion, 'each open request carries the account details');
  await boss.call('POST', '/api/admin/users/legacy/check-recovery', { answer: 'x' }, 400);
  await rc.call('POST', '/api/me/recovery', { question: '', password: 'secret1' });
  assert.strictEqual((await rc.call('GET', '/api/me')).user.recoveryQuestion, '');
  ok('recovery question: optional, stored scrambled, admin can only check an answer; account details shown on requests');

  // ---- sign-up through an invite link ----
  const refd = new Client();
  await refd.call('POST', '/api/auth/register', { username: 'Invitee1', password: 'secret1', email: 'inv1@example.com', adult: true, ref: 'boss' });
  assert.strictEqual(db.users['invitee1'].invitedBy, 'boss');
  const nref = new Client();
  await nref.call('POST', '/api/auth/register', { username: 'Invitee2', password: 'secret1', email: 'inv2@example.com', adult: true, ref: 'nobody-here' });
  assert.strictEqual(db.users['invitee2'].invitedBy, undefined);
  ok('signing up through a friend\'s link remembers who invited you; unknown links are ignored');

  // ---- About / Privacy / Disclaimer pages ----
  for (const [pg, word] of [['about', 'About'], ['privacy', 'Privacy'], ['disclaimer', 'Disclaimer']]) {
    const r = await fetch(base + '/' + pg);
    const html = await r.text();
    assert.strictEqual(r.status, 200, pg + ' page status');
    assert.ok(html.includes(word), pg + ' has its title');
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), pg + ' has no unfilled {{tokens}}');
    assert.ok(html.includes('YOUR BUSINESS NAME'), pg + ' shows the draft reminder until site.json is filled in');
  }
  assert.strictEqual((await fetch(base + '/terms')).status, 404);
  ok('About, Privacy and Disclaimer pages are served, filled in and show the draft reminder');

  // ---- mail not set up: the game must not break ----
  Mailer.setTransport(async () => { throw new Error('down'); });
  await anon.call('POST', '/api/auth/forgot', { who: 'bola' });
  await wait(30);
  ok('an email service that is down does not break the forgot-password page');

  console.log(`\nAll ${passed} account checks passed.`);
  server.close();
  require('../src/db').flush();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nACCOUNT TEST FAILED:', e.message); process.exit(1); });
