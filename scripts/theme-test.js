'use strict';
// Themes: the futuristic default, the picker in Settings, remembered choice, and no page errors. Uses a real server and a real browser.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), net = require('net');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-theme-'));
const DATA = path.join(tmp, 'data');
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let port, child, passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const env = () => { const e = { ...process.env, DATA_DIR: DATA, ADMIN_USER: 'boss', PORT: String(port) }; for (const k of ['CONTENT_DIR','COMMENTARY_DIR','RADIO_DIR','PUZZLES_FILE','WORDSEARCH_FILE','IMAGE_DIR','ADS_DIR','POPUPS_DIR','LOGINBG_DIR','WORLDBG_DIR','SLIDE_FILE','SLIDE_DIR','SITE_FILE','ADMIN_FILE']) delete e[k]; return e; };
const start = () => new Promise((resolve, reject) => {
  child = spawn(process.execPath, ['src/server.js'], { cwd: root, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; const on = (d) => { out += d; if (out.includes('PixSabi is live')) resolve(); };
  child.stdout.on('data', on); child.stderr.on('data', on);
  setTimeout(() => reject(new Error('server did not start: ' + out)), 15000);
});
const base = () => `http://127.0.0.1:${port}`;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base() + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}
(async () => {
  const src = fs.readFileSync(path.join(root, 'public/js/theme.js'), 'utf8');
  assert.ok(/DEFAULT = 'neon'/.test(src));
  port = await freePort(); await start();
  const ada = new Client();
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  for (const f of ['/css/themes.css', '/js/theme.js']) assert.strictEqual((await fetch(base() + f)).status, 200, f);
  assert.ok((await (await fetch(base() + '/sw.js')).text()).includes('/css/themes.css'), 'themes are cached for offline');
  ok('theme files are served and cached');

  let chromium; try { ({ chromium } = require('playwright')); } catch { chromium = null; }
  if (!chromium) { console.log('  skip  browser checks (Playwright is not installed here)'); child.kill(); process.exit(0); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const [name, value] = ada.cookie.split('=');
  await ctx.addCookies([{ name, value, url: base() }]);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const ac = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ac').trim());

  await page.goto(base() + '/#/settings');
  await page.waitForSelector('.th-card');
  assert.strictEqual(await theme(), 'neon'); assert.strictEqual(await ac(), '#5ee7ff');
  assert.strictEqual(await page.locator('.th-card').count(), 4);
  assert.strictEqual(await page.locator('.th-card[aria-pressed="true"] b').innerText(), 'Futuristic');
  assert.strictEqual(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#0a0220');
  ok('new players get the futuristic theme and the picker lists four themes');

  await page.locator('.th-card', { hasText: 'Sunset' }).click();
  assert.strictEqual(await theme(), 'sunset'); assert.strictEqual(await ac(), '#ff9f43');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('ns_theme')), 'sunset');
  assert.strictEqual(await page.locator('.th-card[aria-pressed="true"] b').innerText(), 'Sunset');
  const cardBorder = await page.evaluate(() => getComputedStyle(document.querySelector('.card')).borderTopColor);
  assert.ok(/255, 159, 67/.test(cardBorder), 'cards take the theme glow: ' + cardBorder);
  await page.reload(); await page.waitForSelector('.th-card');
  assert.strictEqual(await theme(), 'sunset');
  ok('picking a theme changes the whole game at once and is remembered after reload');

  await page.locator('.th-card', { hasText: 'Classic' }).click();
  const classicBorder = await page.evaluate(() => getComputedStyle(document.querySelector('.card')).borderTopColor);
  assert.ok(!/255, 159, 67|94, 231, 255/.test(classicBorder), 'Classic keeps its own look: ' + classicBorder);
  await page.locator('.th-card', { hasText: 'Naija Green' }).click();
  assert.strictEqual(await ac(), '#2fcf8e');
  await page.evaluate(() => localStorage.setItem('ns_theme', 'nonsense')); await page.reload(); await page.waitForSelector('.th-card');
  assert.strictEqual(await theme(), 'neon', 'an unknown saved theme falls back to the default');
  ok('Classic keeps the old look, Naija Green works, a bad saved value falls back');

  for (const h of ['#/', '#/ranks', '#/chat', '#/me']) { await page.goto(base() + '/' + h); await page.waitForTimeout(300); }
  assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
  await browser.close(); child.kill();
  console.log(`\n${passed} theme checks passed`);
  process.exit(0);
})().catch((e) => { console.error(e); try { child.kill(); } catch {} process.exit(1); });
