'use strict';
// Run with: npm test (or: node scripts/income-test.js)
// Checks the owner's income tracker: payments are counted by month, typed-in income is checked and added, only the admin can use it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-income-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.ADS_DIR = path.join(tmp, 'ads');
process.env.POPUPS_DIR = path.join(tmp, 'popups');
process.env.ADMIN_USER = 'boss';
const server = require('../src/app');
const { orders } = require('../src/db');
const Income = require('../src/income');
let base;
const ok = (m) => console.log('  ok  ' + m);
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
(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`;
  const boss = new Client(), ada = new Client();
  for (const [c, n] of [[boss, 'boss'], [ada, 'ada']]) await c.call('POST', '/api/auth/register', { username: n, password: 'Passw0rd!x', email: n + '@x.com', adult: true });

  await ada.call('GET', '/api/admin/income', null, 404);
  await ada.call('POST', '/api/admin/income', { month: '2026-11', kind: 'adsense', amount: 10, currency: 'NGN' }, 404);
  ok('only the admin can see or change the income tracker');

  // payments: two coin orders and one premium order in November 2026, one coin order in October 2026 (Nigeria time)
  const at = (iso) => Date.parse(iso);
  const mk = (ref, pack, kobo, when) => { orders.create({ ref, userId: 'ada', pack, coins: 10, amountKobo: kobo, email: 'a@x.com' }); orders.markPaid(ref); require('../src/db').sql.prepare('UPDATE orders SET paid_at = ? WHERE ref = ?').run(at(when), ref); };
  mk('r1', 'c100', 50000, '2026-11-05T10:00:00Z'); mk('r2', 'c500', 150000, '2026-11-20T10:00:00Z'); mk('r3', 'premium', 200000, '2026-11-21T10:00:00Z'); mk('r4', 'c100', 50000, '2026-10-31T23:30:00Z');
  orders.create({ ref: 'r5', userId: 'ada', pack: 'c100', coins: 10, amountKobo: 999999, email: 'a@x.com' });   // never paid: not counted
  let v = await boss.call('GET', '/api/admin/income');
  const nov = v.months.find((m) => m.month === '2026-11'), oct = v.months.find((m) => m.month === '2026-10');
  assert.strictEqual(nov.coins, 2500); assert.strictEqual(nov.premium, 2000); assert.strictEqual(nov.total, 4500);
  assert.strictEqual(oct, undefined, 'an order paid at 23:30 UTC on 31 Oct is 00:30 on 1 Nov in Nigeria');
  ok('coin and premium sales are counted by month in Nigeria time; unpaid orders are ignored');

  // typed-in income
  await boss.call('POST', '/api/admin/income', { month: 'nonsense', kind: 'adsense', amount: 5 }, 400);
  await boss.call('POST', '/api/admin/income', { month: '2026-11', kind: 'bitcoin', amount: 5 }, 400);
  await boss.call('POST', '/api/admin/income', { month: '2026-11', kind: 'adsense', amount: -5 }, 400);
  await boss.call('POST', '/api/admin/income', { month: '2026-11', kind: 'adsense', amount: 'abc' }, 400);
  await boss.call('POST', '/api/admin/income', { month: '2026-11', kind: 'adsense', amount: 50, currency: 'USD' }, 400);   // needs a rate
  v = await boss.call('POST', '/api/admin/income', { month: '2026-11', kind: 'adsense', amount: 50, currency: 'USD', rate: 1500, note: 'week 1' });
  v = await boss.call('POST', '/api/admin/income', { month: '2026-11', kind: 'sponsor', amount: 100000, currency: 'NGN', note: '<b>Brand</b>' });
  const n2 = v.months.find((m) => m.month === '2026-11');
  assert.strictEqual(n2.adsense, 75000); assert.strictEqual(n2.sponsor, 100000); assert.strictEqual(n2.total, 179500);
  assert.strictEqual(v.entries.length, 2);
  assert.strictEqual(v.entries.find((e) => e.kind === 'adsense').naira, 75000);
  ok('typed-in income is checked, dollars use the rate you type, totals add up');

  // delete
  v = await boss.call('DELETE', '/api/admin/income/' + v.entries[0].id);
  assert.strictEqual(v.entries.length, 1);
  await boss.call('DELETE', '/api/admin/income/nope', null, 404);
  await ada.call('DELETE', '/api/admin/income/' + v.entries[0].id, null, 404);
  ok('entries can be deleted by the admin only');

  // saved on disk
  assert.ok(fs.existsSync(Income.FILE));
  assert.strictEqual(JSON.parse(fs.readFileSync(Income.FILE, 'utf8')).entries.length, 1);
  ok('entries are saved in the data folder (the volume)');

  // not in investor reports
  const tok = (await boss.call('POST', '/api/admin/dash/links', { kind: 'investor', label: 't' })).token;
  const rep = await fetch(base + '/api/report/' + tok).then((r) => r.text());
  assert.ok(!rep.includes('75000') && !rep.includes('week 1'), 'investor report has no income entries');
  ok('income entries never appear in investor reports');
  console.log('\nAll income tracker checks passed.');
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
