'use strict';
// Run with: npm test (or: node scripts/dashboard-test.js)
// Checks advert tracking, the owner's dashboard and the private investor/advertiser links.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-dash-'));
fs.mkdirSync(path.join(tmp, 'images'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'content', 'puzzles.json'), path.join(tmp, 'puzzles.json'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PUZZLES_FILE = path.join(tmp, 'puzzles.json');
process.env.IMAGE_DIR = path.join(tmp, 'images');
process.env.ADS_DIR = path.join(tmp, 'ads');
process.env.LOGINBG_DIR = path.join(tmp, 'loginbg');
process.env.WORLDBG_DIR = path.join(tmp, 'worldbg');
process.env.POPUPS_DIR = path.join(tmp, 'popups');
process.env.ADMIN_USER = 'boss';

const server = require('../src/app');
const P = require('../src/puzzles');

const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]).toString('base64');
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(1000, 5)]).toString('base64');
const UA = 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36';
let base;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
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
const vid = (c) => c.repeat(16);

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const boss = new Client(), ada = new Client(), anon = new Client(), viewer = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });

  // ---- adverts with advertiser names ----
  await boss.call('PUT', '/api/admin/ads/1', { image: JPEG, link: 'https://example.com/a', alt: 'A', advertiser: 'Zobo Ltd' });
  await boss.call('PUT', '/api/admin/ads/2', { image: JPEG, link: '', alt: 'B', advertiser: 'Other Co' });
  const pops = await boss.call('POST', '/api/admin/popups', { file: PNG, title: 'Promo', link: 'https://example.com/p', advertiser: 'Zobo Ltd' });
  const popId = pops.items[0].id;
  assert.strictEqual(pops.items[0].advertiser, 'Zobo Ltd');
  const pubAds = (await anon.call('GET', '/api/ads')).ads;
  assert.ok(pubAds.every((a) => !('advertiser' in a)), 'advertiser names are not shown to players');
  assert.ok(!JSON.stringify(await anon.call('GET', '/api/popups')).includes('Zobo'), 'pop-ups do not leak advertiser names');
  ok('advertiser names are saved but never sent to players');

  // ---- tracking rules ----
  const ev = (k, id, e) => ({ k, id, e });
  let r = await anon.call('POST', '/api/track', { vid: vid('a'), events: [ev('ad', 1, 'view'), ev('ad', 1, 'click'), ev('popup', popId, 'view'), ev('popup', popId, 'close')] });
  assert.strictEqual(r.n, 4);
  r = await anon.call('POST', '/api/track', { vid: vid('b'), events: [ev('ad', 1, 'view'), ev('ad', 1, 'close'), ev('ad', 9, 'view'), ev('popup', 'nope', 'view'), ev('ad', 2, 'dance'), null, 'x'] });
  assert.strictEqual(r.n, 1, 'only the real view counts');
  r = await anon.call('POST', '/api/track', { vid: 'bad id!', events: [ev('ad', 1, 'view')] });
  assert.strictEqual(r.n, 0, 'bad visitor id is ignored');
  r = await anon.call('POST', '/api/track', { vid: vid('c'), events: [ev('ad', 1, 'view')] }, 200, { 'User-Agent': 'Googlebot/2.1' });
  assert.strictEqual(r.n, 0, 'bots are not counted');
  r = await anon.call('POST', '/api/track', { vid: vid('d'), events: Array.from({ length: 30 }, () => ev('ad', 2, 'view')) });
  assert.ok(r.n <= 10, 'at most 10 events per call');
  ok('tracking: validation, bots, bad ids, per-call limit');

  // ---- gameplay counters ----
  const p = (await ada.call('GET', '/api/solo/next')).puzzle;
  await ada.call('POST', '/api/solo/guess', { id: p.id, guess: P.fromPublic(p.id).answer });
  await ada.call('POST', '/api/chat', { text: 'hello everyone' }).catch(() => {});

  // ---- admin dashboard ----
  await anon.call('GET', '/api/admin/dash', null, 401);
  await ada.call('GET', '/api/admin/dash', null, 404);
  await ada.call('GET', '/api/admin/dash/links', null, 404);
  await ada.call('POST', '/api/admin/dash/links', { kind: 'investor' }, 404);
  const d = await boss.call('GET', '/api/admin/dash?days=30');
  const txt = JSON.stringify(d);
  assert.ok(d.audience && d.series && d.adverts && d.money, 'overview has its sections');
  assert.ok(!/boss@example|ada@example|"Ada"|"Boss"|127\.0\.0\.1/.test(txt), 'no names, emails or IPs in the numbers');
  const adRow = d.adverts.find((a) => a.kind === 'ad' && String(a.ref) === '1');
  assert.ok(adRow, 'advert 1 is listed');
  assert.strictEqual(adRow.views, 2); assert.strictEqual(adRow.clicks, 1); assert.strictEqual(adRow.uniques, 2);
  const popRow = d.adverts.find((a) => a.kind === 'popup');
  assert.strictEqual(popRow.views, 1); assert.strictEqual(popRow.closes, 1);
  assert.ok(d.advertisers.includes('Zobo Ltd') && d.advertisers.includes('Other Co'));
  assert.ok(d.audience.players >= 2);
  assert.ok(d.games.playsInRange.Naija + d.games.playsInRange.Universal >= 1, 'the solved puzzle was counted');
  assert.ok(d.games.chat.room >= 1, 'the chat message was counted');
  ok('dashboard: admin only, counts and uniques right, nothing personal');

  // ---- links ----
  await boss.call('POST', '/api/admin/dash/links', { kind: 'team' }, 400);
  await boss.call('POST', '/api/admin/dash/links', { kind: 'advertiser', advertiser: '' }, 400);
  await boss.call('POST', '/api/admin/dash/links', { kind: 'advertiser', advertiser: 'Ghost' }, 400);
  const inv = await boss.call('POST', '/api/admin/dash/links', { kind: 'investor', label: 'Seed fund' });
  const adv = await boss.call('POST', '/api/admin/dash/links', { kind: 'advertiser', advertiser: 'Zobo Ltd', label: 'Zobo' });
  assert.ok(/^[A-Za-z0-9_-]{24}$/.test(inv.token), 'long random token');
  assert.strictEqual((await boss.call('GET', '/api/admin/dash/links')).links.length, 2);

  const rep = await viewer.call('GET', `/api/report/${inv.token}?days=30`);               // no login at all
  assert.strictEqual(rep.kind, 'investor');
  assert.ok(rep.audience && rep.money && rep.adverts.length >= 3);
  assert.ok(!/boss@example|ada@example|"Ada"/.test(JSON.stringify(rep)));
  const arep = await viewer.call('GET', `/api/report/${adv.token}?days=30`);
  assert.strictEqual(arep.kind, 'advertiser');
  const at = JSON.stringify(arep);
  assert.ok(!at.includes('Other Co') && !at.includes('"money"'), 'advertiser sees only their own adverts, no revenue');
  assert.strictEqual(arep.adverts.length, 2, 'their side advert and their pop-up');
  assert.ok(arep.audience && arep.totals);
  await viewer.call('GET', '/api/report/' + 'x'.repeat(24), null, 404);
  await viewer.call('GET', '/api/report/short', null, 404);
  const page = await fetch(base + '/r/' + inv.token);
  assert.strictEqual(page.status, 200);
  assert.ok(/noindex/.test(page.headers.get('x-robots-tag') || '') || /noindex/.test(await page.text()));
  assert.strictEqual(page.headers.get('referrer-policy'), 'no-referrer');

  await boss.call('POST', `/api/admin/dash/links/${adv.token}/revoke`, {});
  await viewer.call('GET', `/api/report/${adv.token}`, null, 404);
  await ada.call('DELETE', `/api/admin/dash/links/${inv.token}`, {}, 404);
  await boss.call('DELETE', `/api/admin/dash/links/${inv.token}`, {});
  await viewer.call('GET', `/api/report/${inv.token}`, null, 404);
  assert.strictEqual((await boss.call('GET', '/api/admin/dash/links')).links.length, 1);
  ok('links: create, public report, advertiser sees only theirs, revoke and delete');

  console.log(`\n${passed} dashboard checks passed`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
