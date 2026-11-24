'use strict';
// Run with: npm test (or: node scripts/adsense-test.js)
// Checks Google AdSense support: only valid ad code is accepted (and only the safe parts are kept), nothing shows until it
// is switched on, side slots and pop-ups swap to Google ads, the browser permissions / ads.txt / verification tag follow
// the switch, the privacy page tells the truth, and only the admin can change any of it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-adsense-'));
process.env.DATA_DIR = tmp;
process.env.ADS_DIR = path.join(tmp, 'ads');
process.env.POPUPS_DIR = path.join(tmp, 'popups');
process.env.ADMIN_USER = 'boss';
const { db, newUser } = require('../src/db');
const Adsense = require('../src/adsense');
const Ads = require('../src/ads');
const Pop = require('../src/popups');
const Pages = require('../src/pages');

const handlers = {};
require('../src/routes/admin')({ route: (method, pattern, handler) => { handlers[`${method} ${pattern}`] = handler; } });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { params = {}, body = {} } = {}) => handlers[key]({ user: u, params, body, query: {}, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const PUBID = 'ca-pub-1234567890123456';
const UNIT = (slot, extra = '') => `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUBID}" crossorigin="anonymous"></script>\n<ins class="adsbygoogle" style="display:block" data-ad-client="${PUBID}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"${extra}></ins>\n<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
const BASE = "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'";

(async () => {
  const boss = user('Boss'), ada = user('Ada');

  // ---- reading pasted code ----
  const good = Adsense.parseCode(UNIT('1234567890'));
  assert.deepStrictEqual(good.ad, { client: PUBID, slot: '1234567890', format: 'auto', fullWidth: true, w: 0, h: 0 });
  assert.deepStrictEqual(Adsense.parseCode('<ins class="adsbygoogle" style="display:inline-block;width:300px;height:250px" data-ad-client="' + PUBID + '" data-ad-slot="987654321"></ins>').ad, { client: PUBID, slot: '987654321', format: '', fullWidth: true, w: 300, h: 250 });
  assert.strictEqual(Adsense.parseCode('<script>alert(1)</script>').error !== undefined, true);
  assert.ok(Adsense.parseCode('').error);
  assert.ok(Adsense.parseCode(UNIT('12ab34')).error, 'slot must be digits');
  assert.ok(Adsense.parseCode('<ins data-ad-client="ca-pub-99" data-ad-slot="1234567"></ins>').error, 'bad publisher id');
  assert.ok(Adsense.parseCode(UNIT('1234567890'), 'ca-pub-9999999999999999').error, 'code from another account is refused');
  assert.ok(Adsense.parseCode('x'.repeat(7000)).error);
  // nothing from the pasted text except the checked values can reach the page
  const evil = Adsense.parseCode(UNIT('1234567890', ' onmouseover="alert(1)" data-x="<img src=x onerror=alert(1)>"')).ad;
  assert.ok(!JSON.stringify(evil).includes('alert'));
  assert.strictEqual(Adsense.normalizePublisher('pub-1234567890123456'), PUBID);
  ok('pasted code is checked and only the publisher ID, slot and size are kept');

  // ---- off by default, nothing leaks ----
  assert.strictEqual(Adsense.live(), false);
  assert.strictEqual(Adsense.csp(BASE), BASE);
  assert.strictEqual(Adsense.adsTxt(), '');
  assert.strictEqual(Adsense.injectHead('<head></head>'), '<head></head>');
  assert.ok(Pages.render('privacy').includes('We do not use advertising trackers.'));
  ok('while AdSense is off: no extra permissions, no ads.txt, no tag, privacy page unchanged');

  // ---- admin only ----
  await fails(404, () => call('GET /api/admin/adsense', ada));
  await fails(404, () => call('PUT /api/admin/adsense', ada, { body: { publisher: PUBID, enabled: true } }));
  await fails(404, () => call('PUT /api/admin/adsense/slot/:slot', ada, { params: { slot: '1' }, body: { code: UNIT('1234567890') } }));
  await fails(404, () => call('POST /api/admin/popups/adsense', ada, { body: { code: UNIT('1234567890') } }));
  ok('only the admin can change AdSense');

  // ---- settings ----
  await fails(400, () => call('PUT /api/admin/adsense', boss, { body: { publisher: 'hello' } }));
  await fails(400, () => call('PUT /api/admin/adsense', boss, { body: { publisher: '', enabled: true } }));
  let v = await call('PUT /api/admin/adsense', boss, { body: { publisher: 'pub-1234567890123456', enabled: false } });
  assert.strictEqual(v.publisher, PUBID);
  assert.strictEqual(v.adsTxt, 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0');
  // verification works before switching on
  assert.ok(Adsense.injectHead('<head></head>').includes(`<meta name="google-adsense-account" content="${PUBID}">`));
  assert.ok(!Adsense.injectHead('<head></head>').includes('adsbygoogle.js'));
  assert.strictEqual(Adsense.csp(BASE), BASE);
  ok('publisher ID gives ads.txt and the verification tag while still switched off');

  // ---- side slots ----
  await fails(404, () => call('PUT /api/admin/adsense/slot/:slot', boss, { params: { slot: '9' }, body: { code: UNIT('1234567890') } }));
  await fails(400, () => call('PUT /api/admin/adsense/slot/:slot', boss, { params: { slot: '1' }, body: { code: 'nonsense' } }));
  v = await call('PUT /api/admin/adsense/slot/:slot', boss, { params: { slot: '1' }, body: { code: UNIT('1111111111') } });
  await call('PUT /api/admin/adsense/slot/:slot', boss, { params: { slot: '4' }, body: { code: '2222222222' } }); // just the slot number
  assert.strictEqual(v.side[1].slot, '1111111111');
  assert.strictEqual(Ads.list().length, 0, 'saved code shows nothing while AdSense is off');
  ok('slot codes are saved but stay hidden until AdSense is on');

  // ---- switch on ----
  v = await call('PUT /api/admin/adsense', boss, { body: { publisher: PUBID, enabled: true } });
  assert.strictEqual(v.enabled, true);
  const list = Ads.list();
  assert.deepStrictEqual(list.map((a) => [a.slot, a.side, a.adsense && a.adsense.slot]), [[1, 'left', '1111111111'], [4, 'right', '2222222222']]);
  const pub = await call('GET /api/ads', null);
  assert.strictEqual(pub.ads[0].adsense.client, PUBID);
  assert.ok(!('advertiser' in pub.ads[0]));
  const csp = Adsense.csp(BASE);
  assert.ok(csp.includes('script-src \'self\' https://pagead2.googlesyndication.com'));
  assert.ok(csp.includes('frame-src https://googleads.g.doubleclick.net'));
  assert.ok(csp.includes("frame-ancestors 'none'"), 'the game still cannot be framed');
  assert.ok(!/script-src[^;]*unsafe/.test(csp), 'no unsafe script permissions');
  assert.ok(Adsense.injectHead('<head></head>').includes(`adsbygoogle.js?client=${PUBID}`));
  assert.ok(Pages.render('privacy').includes('Google AdSense'));
  assert.ok(!Pages.render('privacy').includes('We do not use advertising trackers.'));
  ok('switched on: side slots show Google ads, permissions, script tag and privacy page follow');

  // ---- phone header ad ----
  await fails(404, () => call('PUT /api/admin/adsense/mobile', ada, { body: { code: UNIT('3333333333') } }));
  await fails(400, () => call('PUT /api/admin/adsense/mobile', boss, { body: { code: 'nonsense' } }));
  v = await call('PUT /api/admin/adsense/mobile', boss, { body: { code: UNIT('3333333333') } });
  assert.strictEqual(v.mobile.slot, '3333333333');
  assert.ok(!('mobile' in v.side), 'the header ad is not listed as a side slot');
  assert.strictEqual((await call('GET /api/ads', null)).mobile.slot, '3333333333');
  assert.strictEqual(Ads.list().length, 2, 'the header ad is not a side advert');
  v = await call('PUT /api/admin/adsense/mobile', boss, { body: { code: '' } });
  assert.strictEqual(v.mobile, null);
  assert.strictEqual((await call('GET /api/ads', null)).mobile, null);
  ok('phone header ad: admin only, validated, served to the game, removable');

  // ---- race results page ad ----
  await fails(404, () => call('PUT /api/admin/adsense/results', ada, { body: { code: UNIT('4444444444') } }));
  await fails(400, () => call('PUT /api/admin/adsense/results', boss, { body: { code: 'nonsense' } }));
  v = await call('PUT /api/admin/adsense/results', boss, { body: { code: UNIT('4444444444') } });
  assert.strictEqual(v.results.slot, '4444444444');
  assert.ok(!('results' in v.side) && !('mobile' in v.side));
  assert.strictEqual((await call('GET /api/ads', null)).results.slot, '4444444444');
  assert.strictEqual(Ads.list().length, 2, 'the results-page ad is not a side advert');
  v = await call('PUT /api/admin/adsense/results', boss, { body: { code: '' } });
  assert.strictEqual(v.results, null);
  ok('results page ad: admin only, validated, served to the game, removable');

  // a picture slot beside it still works
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(300)]);
  fs.mkdirSync(process.env.ADS_DIR, { recursive: true });
  fs.writeFileSync(Ads.pathFor(2, 'gif'), gif);
  assert.deepStrictEqual(Ads.list().map((a) => a.slot), [1, 2, 4]);
  assert.ok(Ads.list()[1].image && !Ads.list()[1].adsense);
  ok('picture adverts and Google ads sit side by side');

  // removing code
  v = await call('PUT /api/admin/adsense/slot/:slot', boss, { params: { slot: '4' }, body: { code: '' } });
  assert.strictEqual(v.side[4], undefined);
  assert.deepStrictEqual(Ads.list().map((a) => a.slot), [1, 2]);
  ok('removing the code frees the slot');

  // ---- pop-ups: Google ads are not allowed there ----
  await fails(400, () => call('POST /api/admin/popups/adsense', boss, { body: { code: UNIT('3333333333'), title: 'Sponsored' } }));
  const Pop = require('../src/popups');
  Pop.write({ settings: { ...Pop.DEFAULTS, enabled: true }, items: [{ id: 'abc1234567', kind: 'adsense', ext: '', adsense: { client: PUBID, slot: '3333333333' }, active: true, advertiser: 'Google AdSense' }] });
  assert.strictEqual(Pop.read().items.length, 0, 'an old AdSense pop-up is dropped');
  assert.strictEqual((await call('GET /api/popups', null)).items.length, 0, 'players never get a Google pop-up');
  ok('AdSense cannot be put in pop-ups (refused, and any old one is ignored)');

  // ---- new account clears old codes ----
  await call('PUT /api/admin/adsense', boss, { body: { publisher: 'ca-pub-9999999999999999', enabled: false } });
  assert.deepStrictEqual((await call('GET /api/admin/adsense', boss)).side, {});
  ok('a different publisher ID clears the old ad codes');

  const saved = JSON.parse(fs.readFileSync(path.join(process.env.ADS_DIR, 'adsense.json'), 'utf8'));
  assert.strictEqual(saved.publisher, 'ca-pub-9999999999999999');
  ok('settings are saved on the ads folder (the volume)');

  console.log(`\n${passed} AdSense checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
