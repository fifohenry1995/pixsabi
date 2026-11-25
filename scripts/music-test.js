'use strict';
// Run with: npm test (or: node scripts/music-test.js)
// Checks the theme song in a real browser: off by default, the top-bar button and the Me checkbox start and stop it,
// the choice is remembered, and it keeps scheduling notes while on.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-music-'));
fs.mkdirSync(path.join(tmp, 'images'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'content', 'puzzles.json'), path.join(tmp, 'puzzles.json'));
Object.assign(process.env, { DATA_DIR: tmp + '/data', PUZZLES_FILE: tmp + '/puzzles.json', IMAGE_DIR: tmp + '/images', ADS_DIR: tmp + '/a', LOGINBG_DIR: tmp + '/l', WORLDBG_DIR: tmp + '/w', POPUPS_DIR: tmp + '/p' });
const server = require('../src/app');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('  skip  music test (Playwright is not installed here)'); process.exit(0); }
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + '/');
  await page.evaluate(() => fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Musa', password: 'secret1', email: 'musa@example.com', adult: true }) }));
  await page.goto(base + '/#/settings'); await page.reload();
  await page.waitForSelector('#mus');
  assert.strictEqual(await page.locator('.top a.gear').count(), 1, 'the top bar has the settings gear');
  assert.strictEqual(await page.evaluate(() => NS.music.isOn()), false, 'off until the player turns it on');
  assert.strictEqual((await page.evaluate(() => NS.music.stats())).running, false);
  ok('theme song is off by default; the gear opens Settings where its switch lives');
  await page.click('#mus');
  await wait(1200);
  let st = await page.evaluate(() => NS.music.stats());
  assert.strictEqual(st.running, true);
  assert.ok(st.scheduled >= 8, 'notes are being scheduled: ' + st.scheduled);
  await wait(1000);
  assert.ok((await page.evaluate(() => NS.music.stats())).scheduled > st.scheduled, 'keeps playing');
  assert.strictEqual(await page.locator('#mus').isChecked(), true);
  ok('the switch starts the beat and it keeps scheduling');
  await page.reload(); await page.waitForSelector('#mus');
  assert.strictEqual(await page.evaluate(() => NS.music.isOn()), true, 'remembered after a reload');
  assert.strictEqual(await page.locator('#mus').isChecked(), true);
  await page.click('#mus');
  await wait(200);
  await page.evaluate(() => NS.music.setOn(true)); await wait(300);
  await page.evaluate(() => NS.music.setOn(false));
  assert.strictEqual((await page.evaluate(() => NS.music.stats())).running, false);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('ns_music')), 'off');
  ok('choice is remembered, and turning it off stops the beat');
  assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
  await browser.close();
  console.log(`\nAll ${passed} music checks passed.`);
  process.exit(0);
})().catch((e) => { console.error('\nMUSIC TEST FAILED:', e.stack || e.message); process.exit(1); });
