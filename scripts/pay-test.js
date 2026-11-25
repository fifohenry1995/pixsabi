'use strict';
// Checks buying coins against a FAKE Paystack running on your own computer (no real money, no internet).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-pay-'));
process.env.DATA_DIR = tmp;
process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake_key';

// ---- the fake Paystack ----
const txns = {};      // reference -> { amount, status }
let initCalls = 0;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== 'Bearer sk_test_fake_key') return send(401, { status: false, message: 'Invalid key' });
    if (req.method === 'POST' && req.url === '/transaction/initialize') {
      initCalls++;
      const b = JSON.parse(body);
      txns[b.reference] = { amount: b.amount, status: 'abandoned', currency: b.currency, callback: b.callback_url, email: b.email };
      return send(200, { status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference } });
    }
    const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
    if (m && txns[m[1]]) { const t = txns[m[1]]; return send(200, { status: true, data: { status: t.status, amount: t.amount, currency: t.currency, reference: m[1] } }); }
    send(404, { status: false, message: 'Transaction not found' });
  });
});

const server = require('../src/app');
const { db, orders } = require('../src/db');
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
const sign = (raw) => crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
async function webhook(ref, { key, event = 'charge.success' } = {}) {
  const raw = JSON.stringify({ event, data: { reference: ref, status: 'success' } });
  const sig = key === undefined ? sign(raw) : key;
  const res = await fetch(base + '/api/paystack/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig }, body: raw });
  return res.status;
}
const goBack = async (ref) => { const r = await fetch(`${base}/pay/return?reference=${ref}`, { redirect: 'manual' }); return { status: r.status, to: r.headers.get('location') }; };

let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.PAYSTACK_API_URL = `http://127.0.0.1:${fake.address().port}`;
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const ada = new Client(), bola = new Client(), anon = new Client();
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  await bola.call('POST', '/api/auth/register', { username: 'Bola', password: 'secret1', email: 'bola@example.com', adult: true });

  // ---- packs and basic checks ----
  const info = await ada.call('GET', '/api/coins/packs');
  assert.strictEqual(info.enabled, true);
  assert.deepStrictEqual(info.packs.map((p) => [p.coins, p.price]), [[200, 500], [600, 1200], [1500, 2500]]);
  await anon.call('GET', '/api/coins/packs', null, 401);
  await anon.call('POST', '/api/coins/buy', { pack: 'c200', email: 'a@b.com' }, 401);
  await ada.call('POST', '/api/coins/buy', { pack: 'free', email: 'a@b.com' }, 400);
  await ada.call('POST', '/api/coins/buy', { pack: 'c200', email: 'not an email' }, 400);
  await ada.call('POST', '/api/coins/buy', { pack: 'c200', amount: 1, email: '' }, 400);
  assert.strictEqual(initCalls, 0, 'nothing is sent to Paystack for bad requests');
  ok('packs are listed; bad packs/emails and logged-out buyers are refused');

  // ---- a normal purchase ----
  const buy = await ada.call('POST', '/api/coins/buy', { pack: 'c600', email: 'ada@example.com' });
  assert.ok(buy.url.startsWith('https://checkout.paystack.test/NS'));
  const ref = buy.reference;
  assert.strictEqual(txns[ref].amount, 120000, 'amount is in kobo (naira x 100), taken from OUR price list');
  assert.strictEqual(txns[ref].currency, 'NGN');
  assert.ok(txns[ref].callback.endsWith('/pay/return'));
  assert.strictEqual(db.users.ada.coins, 100, 'no coins before payment');
  let back = await goBack(ref);                     // came back without paying
  assert.strictEqual(back.status, 302);
  assert.strictEqual(back.to, '/?paid=cancelled');
  assert.strictEqual(db.users.ada.coins, 100, 'abandoned payment gives nothing');
  txns[ref].status = 'success';                     // the player pays on Paystack
  back = await goBack(ref);
  assert.strictEqual(back.to, '/?paid=paid');
  assert.strictEqual(db.users.ada.coins, 700, '100 + 600');
  assert.strictEqual((await ada.call('GET', '/api/me')).user.coins, 700);
  ok('coins are added only after Paystack confirms the payment');

  // ---- paying cannot be repeated for more coins ----
  await goBack(ref);
  assert.strictEqual(await webhook(ref), 200);
  assert.strictEqual(db.users.ada.coins, 700, 'return page + webhook again do not add coins twice');
  const rows = orders.recent('ada');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'paid');
  ok('the same payment never gives coins twice');

  // ---- webhook and return page at the same moment ----
  const b2 = await bola.call('POST', '/api/coins/buy', { pack: 'c200', email: 'bola@example.com' });
  txns[b2.reference].status = 'success';
  await Promise.all([webhook(b2.reference), goBack(b2.reference), goBack(b2.reference), webhook(b2.reference)]);
  assert.strictEqual(db.users.bola.coins, 300, 'a race between webhook and return still gives 200 coins once');
  ok('simultaneous webhook and return give coins exactly once');

  // ---- webhook safety ----
  const b3 = await bola.call('POST', '/api/coins/buy', { pack: 'c200', email: 'bola@example.com' });
  txns[b3.reference].status = 'success';
  assert.strictEqual(await webhook(b3.reference, { key: 'f'.repeat(128) }), 401, 'wrong signature refused');
  assert.strictEqual(await webhook(b3.reference, { key: '' }), 401, 'missing signature refused');
  assert.strictEqual(await webhook(b3.reference, { key: 'xyz' }), 401, 'malformed signature refused');
  assert.strictEqual(db.users.bola.coins, 300, 'refused webhooks give nothing');
  assert.strictEqual(await webhook('NS' + '0'.repeat(20)), 200, 'unknown reference is ignored');
  assert.strictEqual(await webhook(b3.reference, { event: 'charge.failed' }), 200);
  assert.strictEqual(db.users.bola.coins, 300, 'other events are ignored');
  assert.strictEqual(await webhook(b3.reference), 200);                       // the real signed one
  assert.strictEqual(db.users.bola.coins, 500, 'a correctly signed charge.success adds the coins');
  ok('webhook needs a valid Paystack signature');

  // ---- wrong amount / failed / unknown ----
  const b4 = await bola.call('POST', '/api/coins/buy', { pack: 'c1500', email: 'bola@example.com' });
  txns[b4.reference].status = 'success'; txns[b4.reference].amount = 100;       // paid far too little
  assert.strictEqual((await goBack(b4.reference)).to, '/?paid=failed');
  assert.strictEqual(db.users.bola.coins, 500, 'underpaying gives nothing');
  assert.strictEqual(orders.get(b4.reference).status, 'mismatch');
  const b5 = await bola.call('POST', '/api/coins/buy', { pack: 'c200', email: 'bola@example.com' });
  txns[b5.reference].status = 'failed';
  assert.strictEqual((await goBack(b5.reference)).to, '/?paid=failed');
  assert.strictEqual((await goBack('NS' + 'a'.repeat(20))).to, '/?paid=unknown');
  assert.strictEqual((await goBack('../../etc/passwd')).to, '/?paid=unknown');
  assert.strictEqual(db.users.bola.coins, 500);
  ok('wrong amounts, failed payments and made-up references give nothing');

  // ---- one player cannot collect for another player's order ----
  const ref6 = (await ada.call('POST', '/api/coins/buy', { pack: 'c200', email: 'ada@example.com' })).reference;
  txns[ref6].status = 'success';
  await goBack(ref6);
  assert.strictEqual(db.users.ada.coins, 900, 'coins go to the player who started the order');
  assert.strictEqual(db.users.bola.coins, 500);

  // ---- survives a restart (paid orders are on disk) ----
  require('../src/db').flush();
  const again = require('../src/db').orders.get(ref);
  assert.strictEqual(again.status, 'paid');
  assert.strictEqual(again.coins, 600);
  ok('orders are saved with the purchase and who got the coins');

  // ---- Paystack unreachable / switched off ----
  const realUrl = process.env.PAYSTACK_API_URL;
  process.env.PAYSTACK_API_URL = 'http://127.0.0.1:1';
  await ada.call('POST', '/api/coins/buy', { pack: 'c200', email: 'ada@example.com' }, 502);
  process.env.PAYSTACK_API_URL = realUrl;
  const key = process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_SECRET_KEY;
  assert.strictEqual((await ada.call('GET', '/api/coins/packs')).enabled, false);
  await ada.call('POST', '/api/coins/buy', { pack: 'c200', email: 'ada@example.com' }, 503);
  assert.strictEqual(await webhook(ref, { key: 'a'.repeat(128) }), 401, 'with no key set, no signature is ever accepted');
  process.env.PAYSTACK_SECRET_KEY = key;
  ok('payment service down or not set up: clear errors, nothing breaks');

  console.log(`\nAll ${passed} payment checks passed.`);
  process.exit(0);
})().catch((e) => { console.error('\nPAYMENT TEST FAILED:', e.stack || e.message); process.exit(1); });
