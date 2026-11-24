'use strict';
// Run with: npm test (or: node scripts/premium-test.js)
// Checks Premium: 30 days, renewing, fun facts only for members, no pop-ups, gold flag, paying with a FAKE Paystack.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-prem-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.POPUPS_DIR = path.join(tmp, 'popups');
process.env.ADMIN_USER = 'boss';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake_key';

const txns = {};
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && req.url === '/transaction/initialize') {
      const b = JSON.parse(body);
      txns[b.reference] = { amount: b.amount, status: 'abandoned', currency: b.currency };
      return send(200, { status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference } });
    }
    const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
    if (m && txns[m[1]]) { const t = txns[m[1]]; return send(200, { status: true, data: { status: t.status, amount: t.amount, currency: t.currency, reference: m[1] } }); }
    send(404, { status: false });
  });
});

const server = require('../src/app');
const P = require('../src/puzzles');
const Premium = require('../src/premium');
const { db } = require('../src/db');
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(1000, 5)]).toString('base64');
const DAY = 24 * 3600 * 1000;
let base;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
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

(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.PAYSTACK_API_URL = `http://127.0.0.1:${fake.address().port}`;
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const boss = new Client(), ada = new Client(), bola = new Client(), anon = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  await bola.call('POST', '/api/auth/register', { username: 'Bola', password: 'secret1', email: 'bola@example.com', adult: true });

  // ---- locked by default, opened from the admin page ----
  assert.strictEqual(Premium.isOpen(), false, 'locked until the owner opens it');
  assert.deepStrictEqual(Premium.gate(null, { fact: 'x' }), { fact: 'x' }, 'locked: facts are free for everybody');
  assert.strictEqual((await ada.call('GET', '/api/premium')).enabled, false);
  await ada.call('POST', '/api/premium/buy', { email: 'ada@example.com' }, 503);
  assert.strictEqual((await ada.call('GET', '/api/me')).user.premiumOpen, false);
  assert.strictEqual((await anon.call('GET', '/api/popups')).premiumOpen, false, 'the pop-up Go Premium line stays hidden while locked');
  await ada.call('GET', '/api/admin/premium', null, 404);
  await ada.call('PUT', '/api/admin/premium/settings', { open: true }, 404);
  assert.deepStrictEqual(await boss.call('GET', '/api/admin/premium'), { open: false, members: 0 });
  assert.deepStrictEqual(await boss.call('PUT', '/api/admin/premium/settings', { open: true }), { open: true });
  assert.strictEqual((await ada.call('GET', '/api/me')).user.premiumOpen, true);
  assert.ok(fs.readFileSync(path.join(tmp, 'data', 'premium.json'), 'utf8').includes('true'), 'the choice is saved');
  ok('Premium is locked by default; only the admin can open it; locked means no buying and free fun facts');

  // ---- the rules ----
  const u = { };
  assert.strictEqual(Premium.isPremium(u), false);
  const t1 = Premium.grant(u);
  assert.ok(Math.abs(t1 - (Date.now() + 30 * DAY)) < 5000, '30 days');
  assert.strictEqual(Premium.daysLeft(u), 30);
  const t2 = Premium.grant(u);
  assert.ok(Math.abs(t2 - (t1 + 30 * DAY)) < 5, 'renewing early adds 30 days on top');
  u.premiumUntil = Date.now() - 1000;
  assert.strictEqual(Premium.isPremium(u), false, 'it ends after the time is up');
  assert.ok(Math.abs(Premium.grant(u) - (Date.now() + 30 * DAY)) < 5000, 'an ended premium restarts from today');
  Premium.remove(u); assert.strictEqual(Premium.isPremium(u), false);
  assert.deepStrictEqual(Premium.gate(null, { fact: 'x', a: 1 }), { a: 1, factLocked: true });
  assert.deepStrictEqual(Premium.gate(null, { fact: '', a: 1 }), { a: 1 }, 'no teaser when there was no fact');
  ok('premium lasts 30 days, early renewal stacks, an ended one restarts, facts are gated');

  // ---- buying ----
  await anon.call('GET', '/api/premium', null, 401);
  const info = await ada.call('GET', '/api/premium');
  assert.strictEqual(info.enabled, true); assert.strictEqual(info.price, 1000); assert.strictEqual(info.days, 30); assert.strictEqual(info.premium, false);
  await ada.call('POST', '/api/premium/buy', { email: 'nope' }, 400);
  const buy = await ada.call('POST', '/api/premium/buy', { email: 'ada@example.com' });
  assert.strictEqual(txns[buy.reference].amount, 100000, 'N1,000 in kobo, taken from OUR price');
  const coins0 = db.users.ada.coins;
  const back = async (ref) => (await fetch(`${base}/pay/return?reference=${ref}`, { redirect: 'manual' })).headers.get('location');
  assert.strictEqual(await back(buy.reference), '/?paid=cancelled&for=premium');
  assert.strictEqual(Premium.isPremium(db.users.ada), false, 'nothing before paying');
  txns[buy.reference].status = 'success';
  assert.strictEqual(await back(buy.reference), '/?paid=paid&for=premium');
  assert.strictEqual(Premium.isPremium(db.users.ada), true);
  assert.strictEqual(db.users.ada.coins, coins0, 'premium gives no coins');
  const until1 = db.users.ada.premiumUntil;
  await back(buy.reference);
  assert.strictEqual(db.users.ada.premiumUntil, until1, 'paying once cannot be counted twice');
  const me = (await ada.call('GET', '/api/me')).user;
  assert.strictEqual(me.premium, true); assert.ok(me.premiumDaysLeft >= 29);
  // renew early
  const buy2 = await ada.call('POST', '/api/premium/buy', { email: 'ada@example.com' });
  txns[buy2.reference].status = 'success'; await back(buy2.reference);
  assert.ok(Math.abs(db.users.ada.premiumUntil - (until1 + 30 * DAY)) < 5, 'second payment adds 30 more days');
  assert.strictEqual((await ada.call('GET', '/api/premium')).daysLeft, 60);
  ok('paying N1,000 starts 30 days (once only), renewing stacks, no coins given');

  // ---- fun facts ----
  const withFact = P.puzzles.find((p) => p.fact && p.category === 'Naija');
  const play = async (c) => {
    // keep asking for the next puzzle until we are given one that has a fun fact, then solve it
    for (let i = 0; i < 120; i++) {
      const n = await c.call('GET', '/api/solo/next');
      if (!n.puzzle) break;
      const p = P.fromPublic(n.puzzle.id);
      const r = await c.call('POST', '/api/solo/guess', { id: n.puzzle.id, guess: p.answer });
      if (p.fact) return { r, p };
    }
    return null;
  };
  if (withFact) {
    const a = await play(ada); assert.ok(a, 'ada found a puzzle with a fact');
    assert.strictEqual(a.r.fact, a.p.fact, 'premium member sees the fun fact');
    const b = await play(bola); assert.ok(b, 'bola found a puzzle with a fact');
    assert.ok(!('fact' in b.r), 'other players do not get the fact');
    assert.strictEqual(b.r.factLocked, true, 'they get an invitation instead');
    assert.ok(!JSON.stringify(b.r).includes(b.p.fact));
  }
  ok('fun facts come only to premium members; others get a locked invitation');

  // ---- pop-ups ----
  await boss.call('POST', '/api/admin/popups', { file: PNG, title: 'Shop' });
  await boss.call('PUT', '/api/admin/popups/settings', { enabled: true, every: 5, closeAfter: 3 });
  const pb = await bola.call('GET', '/api/popups');
  assert.ok(pb.enabled && pb.items.length === 1, 'a normal player gets the pop-up advert');
  assert.strictEqual(pb.premiumOpen, true, 'once open, the pop-up shows the Go Premium line');
  const pa = await ada.call('GET', '/api/popups');
  assert.strictEqual(pa.enabled, false); assert.deepStrictEqual(pa.items, []);
  ok('premium members get no pop-up adverts');

  // ---- gold mark ----
  assert.strictEqual((await bola.call('GET', '/api/players/Ada')).player.premium, true);
  assert.strictEqual((await ada.call('GET', '/api/players/Bola')).player.premium, false);
  await ada.call('POST', '/api/chat', { text: 'hello from ada' }).catch(() => {});
  await bola.call('POST', '/api/chat', { text: 'hello from bola' }).catch(() => {});
  const chat = await bola.call('GET', '/api/chat');
  const msgs = chat.messages || chat;
  const ma = msgs.find((m) => m.username === 'Ada'), mb = msgs.find((m) => m.username === 'Bola');
  assert.ok(ma && mb, 'both messages are in the chat'); assert.strictEqual(ma.premium, true); assert.strictEqual(mb.premium, false);
  ok('gold flag shows on profile and chat for members only');

  // ---- admin ----
  await ada.call('POST', '/api/admin/premium', { username: 'Bola', days: 30 }, 404);
  await anon.call('POST', '/api/admin/premium', { username: 'Bola', days: 30 }, 401);
  await boss.call('POST', '/api/admin/premium', { username: 'Nobody', days: 30 }, 404);
  await boss.call('POST', '/api/admin/premium', { username: 'Bola', days: 5000 }, 400);
  const g = await boss.call('POST', '/api/admin/premium', { username: 'Bola', days: 7 });
  assert.strictEqual(g.premium, true); assert.strictEqual(g.daysLeft, 7);
  const r = await boss.call('POST', '/api/admin/premium', { username: 'Bola', days: 0 });
  assert.strictEqual(r.premium, false);
  ok('only the admin can give or remove premium');

  // ---- dashboard ----
  const d = await boss.call('GET', '/api/admin/dash?days=30');
  assert.strictEqual(d.money.premiumPurchases, 2);
  assert.strictEqual(d.money.premiumNaira, 2000);
  assert.strictEqual(d.money.premiumActive, 1);
  ok('dashboard counts premium sales and active members');

  console.log(`\nAll ${passed} premium checks passed.`);
  server.close(); fake.close(); setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('PREMIUM TEST FAILED:', e); process.exit(1); });
