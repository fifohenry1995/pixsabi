'use strict';
// Run with: npm test (or: node scripts/verify-test.js)
// Checks the anti-fake-account protections: email confirmation links, what an unconfirmed player cannot do,
// the daily cap on invite rewards, and the Cloudflare Turnstile check on sign-up.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-verify-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.ADMIN_USER = 'boss';
process.env.AUTH_LIMIT = '1000';
process.env.PUBLIC_URL = 'https://play.example.com';
delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;

const server = require('../src/app');
const Mailer = require('../src/mailer');
const Verify = require('../src/verify');
const Turnstile = require('../src/turnstile');
const Invites = require('../src/routes/invites');
const Weekly = require('../src/weekly');
const Points = require('../src/points');
const { db } = require('../src/db');

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
const reg = (c, name, o, expect) => c.call('POST', '/api/auth/register', { username: name, password: 'secret1', email: name.toLowerCase() + '@example.com', adult: true, ...o }, expect);
const tokenIn = (mail) => /#\/verify\/([\w.-]+)/.exec(mail.text)[1];
const race = { category: 'Naija', levels: 20, maxPlayers: 2, stake: 10 };

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  // ---- email sending not set up: nothing is blocked ----
  const a0 = new Client();
  const r0 = await reg(a0, 'Early');
  assert.strictEqual(r0.user.emailPending, false);
  assert.strictEqual(Verify.enabled(), false);
  ok('without email sending set up, nobody is held back');

  // ---- email sending set up ----
  process.env.RESEND_API_KEY = 'k'; process.env.MAIL_FROM = 'Sabi <hi@example.com>';
  assert.strictEqual(Verify.enabled(), true);
  const ada = new Client(), bola = new Client();
  const r1 = await reg(ada, 'Ada');
  await wait(30);
  assert.strictEqual(r1.user.emailPending, true);
  const mail = sent.find((m) => m.to[0] === 'ada@example.com');
  assert.ok(mail && mail.text.includes('https://play.example.com/#/verify/'), 'a confirmation link is emailed');
  ok('sign-up emails a confirmation link and marks the account pending');

  // ---- what a pending player cannot do ----
  await ada.call('POST', '/api/challenges', { ...race, stake: 0 });            // free races are fine
  db.users.bola = undefined; delete db.users.bola;
  await reg(bola, 'Bola'); await bola.call('POST', '/api/auth/verify', { token: tokenIn(sent.find((m) => m.to[0] === 'bola@example.com')) });
  ok('races are free for everybody (staking is gone)');

  // ---- the link ----
  const tok = tokenIn(mail);
  await ada.call('POST', '/api/auth/verify', { token: tok + 'x' }, 400);
  await ada.call('POST', '/api/auth/verify', { token: 'garbage' }, 400);
  assert.strictEqual(Verify.readToken(tok, Date.now() + Verify.TTL_MS + 1000), null, 'expired link');
  await ada.call('POST', '/api/auth/verify', { token: tok });
  assert.strictEqual((await ada.call('GET', '/api/me')).user.emailPending, false);
  ok('the link confirms the email; bad or expired links do nothing');

  // ---- changing the email asks again, and the old link stops working ----
  await ada.call('POST', '/api/me/email', { email: 'ada2@example.com', password: 'secret1' });
  await wait(30);
  assert.strictEqual((await ada.call('GET', '/api/me')).user.emailPending, true);
  const mail2 = sent.filter((m) => m.to[0] === 'ada2@example.com').pop();
  await ada.call('POST', '/api/auth/verify', { token: tok }, 400);
  await ada.call('POST', '/api/auth/verify', { token: tokenIn(mail2) });
  assert.strictEqual((await ada.call('GET', '/api/me')).user.emailPending, false);
  ok('a changed email must be confirmed again, and an old link no longer works');

  // ---- resend ----
  const cy = new Client(); await reg(cy, 'Cyrus');
  await cy.call('POST', '/api/auth/verify/resend', {});
  await cy.call('POST', '/api/auth/verify/resend', {}, 429);
  ok('"send the link again" works but is limited to one a minute');

  // ---- invite coins ----
  const inviter = db.users.ada; inviter.coins = 0; inviter.invited = [];
  const friend = (n) => { const f = { id: n, username: n, coins: 0, solved: {}, invitedBy: 'ada', emailPending: false }; db.users[n] = f; inviter.invited.push({ id: n, username: n, done: false }); return f; };
  const f1 = friend('fone'); f1.emailPending = true;
  assert.strictEqual(Invites.firstSolve(f1), 0); assert.strictEqual(inviter.coins, 0); assert.strictEqual(f1.inviteDone, undefined);
  f1.emailPending = false;
  assert.strictEqual(Invites.firstSolve(f1), Invites.INVITE_COINS); assert.strictEqual(inviter.coins, Invites.INVITE_COINS);
  for (let i = 2; i <= 7; i++) Invites.firstSolve(friend('f' + i));
  assert.strictEqual(inviter.inviteRewarded, Invites.MAX_PER_DAY, 'inviter is paid for at most 5 friends a day');
  assert.strictEqual(db.users.f7.coins, Invites.INVITE_COINS, 'the friend still gets their coins');
  inviter.emailPending = true; inviter.inviteDay = { d: '1999-01-01', n: 0 };
  const before = inviter.coins; Invites.firstSolve(friend('f8')); assert.strictEqual(inviter.coins, before, 'a pending inviter is not paid');
  ok('invite coins: friend must be confirmed, inviter capped at 5 a day and must be confirmed');

  // ---- weekly prizes ----
  const prev = Points.prevWeekIdOf();
  const mk = (name, pts, pend) => { const u = { id: name, username: name, coins: 10, points: pts, solved: {}, emailPending: pend }; db.users[name] = u; Points.ensure(u); u.week = { id: prev, pts }; return u; };
  const w1 = mk('wone', 900, true), w2 = mk('wtwo', 800, false), w3 = mk('wthree', 700, false);
  require('../src/db').meta.set('weekly_paid', '');   // the server may already have settled this week at start-up
  Weekly.settle();
  assert.strictEqual(w1.coins, 10, 'an unconfirmed player is not paid');
  assert.strictEqual(w2.coins, 110); assert.strictEqual(w3.coins, 60);
  ok('weekly coin prizes are not paid to players who have not confirmed their email');

  // ---- Turnstile ----
  const t1 = new Client();
  assert.strictEqual(Turnstile.enabled(), false);
  assert.strictEqual((await t1.call('GET', '/api/stats')).turnstile, null);
  process.env.TURNSTILE_SITE_KEY = 'site-key'; process.env.TURNSTILE_SECRET_KEY = 'secret-key';
  assert.strictEqual((await t1.call('GET', '/api/stats')).turnstile, 'site-key');
  const seen = [];
  Turnstile.setTransport(async (body) => { seen.push(body); return { success: /response=good/.test(body) }; });
  await reg(t1, 'Tee', {}, 400);                                  // no token
  await reg(t1, 'Tee', { cfToken: 'bad' }, 400);
  assert.strictEqual(db.users.tee, undefined);
  await reg(t1, 'Tee', { cfToken: 'good' });
  assert.ok(seen.every((b) => b.includes('secret=secret-key')) && seen.length === 2, 'the secret key stays on the server and empty tokens are not sent');
  Turnstile.setTransport(async () => { throw new Error('cloudflare down'); });
  await reg(new Client(), 'Uno', { cfToken: 'good' }, 503);
  assert.strictEqual(db.users.uno, undefined);
  const csp = Turnstile.csp("default-src 'self'; script-src 'self'; connect-src 'self'; frame-src https://a.test; frame-ancestors 'none'");
  assert.ok(csp.includes('script-src \'self\' https://challenges.cloudflare.com') && csp.includes('frame-src https://challenges.cloudflare.com https://a.test'));
  assert.strictEqual((csp.match(/frame-src/g) || []).length, 1, 'one frame-src only, merged with AdSense');
  delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;
  assert.strictEqual(Turnstile.csp('x'), 'x');
  ok('Turnstile: sign-up needs a passed check when on, Cloudflare failure refuses safely, permissions merge into the CSP, off when unset');

  console.log(`\nAll ${passed} confirmation and sign-up checks passed.`);
  server.close();
  require('../src/db').flush();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nVERIFY TEST FAILED:', e.stack || e.message); process.exit(1); });
