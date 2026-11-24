'use strict';
// Run with: npm test (or: node scripts/social-test.js)
// Checks the contact and social links: only the admin can set them, handles/numbers/links all become safe links on the
// right websites, anything else is refused, and players only see the filled-in ones.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-social-'));
process.env.ADMIN_USER = 'boss';
const { db, newUser } = require('../src/db');
const Social = require('../src/social');

const handlers = {};
require('../src/routes/social')({ route: (method, pattern, handler) => { handlers[`${method} ${pattern}`] = handler; } });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { body = {} } = {}) => handlers[key]({ user: u, params: {}, body, query: {}, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const url = (k, v) => (Social.normalize(k, v) || {}).url;

(async () => {
  const boss = user('Boss'), ada = user('Ada');

  assert.deepStrictEqual((await call('GET /api/social', null)).links, []);
  ok('nothing shows until the admin fills something in');

  await fails(404, () => call('GET /api/admin/social', ada));
  await fails(404, () => call('PUT /api/admin/social', ada, { body: { x: '@me' } }));
  ok('only the admin can read or change the links');

  assert.ok(url('contact', '0803 123 4567').startsWith('https://wa.me/2348031234567?text='));
  assert.ok(url('contact', '+234 801 234 5678').startsWith('https://wa.me/2348012345678'));
  assert.strictEqual(url('x', '@SabiNaija'), 'https://x.com/SabiNaija');
  assert.strictEqual(url('x', 'https://twitter.com/sabi_naija?lang=en'), 'https://x.com/sabi_naija');
  assert.strictEqual(url('instagram', 'sabi.naija'), 'https://www.instagram.com/sabi.naija/');
  assert.strictEqual(url('instagram', 'https://instagram.com/sabi.naija/?hl=en'), 'https://www.instagram.com/sabi.naija/');
  assert.strictEqual(url('tiktok', '@pixsabi'), 'https://www.tiktok.com/@pixsabi');
  assert.strictEqual(url('tiktok', 'https://www.tiktok.com/@pixsabi?lang=en'), 'https://www.tiktok.com/@pixsabi');
  assert.strictEqual(url('facebook', 'sabinaijagame'), 'https://www.facebook.com/sabinaijagame');
  assert.strictEqual(url('facebook', 'https://m.facebook.com/sabinaijagame'), 'https://www.facebook.com/sabinaijagame');
  assert.strictEqual(url('channel', 'https://whatsapp.com/channel/0029VaAbCdEf1234?x=1'), 'https://whatsapp.com/channel/0029VaAbCdEf1234');
  assert.strictEqual(Social.normalize('x', '@SabiNaija').label, '@SabiNaija');
  assert.strictEqual(Social.normalize('x', ''), null);
  ok('handles, numbers and links all become clean links on the right website');

  for (const [k, v] of [['x', 'javascript:alert(1)'], ['x', 'https://evil.example/sabi'], ['x', '@bad handle!'], ['instagram', 'data:text/html,hi'], ['tiktok', 'https://tiktok.com.evil.example/@a'],
    ['facebook', 'https://facebook.com@evil.example/page'], ['channel', 'https://evil.example/channel/abcdef'], ['channel', 'hello'], ['contact', 'call me'], ['contact', '123']]) {
    const r = Social.normalize(k, v);
    assert.ok(r && r.error, `${k} "${v}" must be refused`);
  }
  await fails(400, () => call('PUT /api/admin/social', boss, { body: { x: 'https://evil.example/me' } }));
  ok('scripts, other websites and look-alike addresses are refused');

  const r = await call('PUT /api/admin/social', boss, { body: { contact: '08031234567', x: '@SabiNaija', instagram: 'sabi.naija', facebook: '', tiktok: '  ', channel: '' } });
  assert.deepStrictEqual(r.links.map((l) => l.kind), ['contact', 'x', 'instagram']);
  const pub = await call('GET /api/social', null);
  assert.deepStrictEqual(pub.links.map((l) => l.kind), ['contact', 'x', 'instagram']);
  assert.strictEqual(pub.links[1].label, '@SabiNaija');
  assert.ok(!JSON.stringify(pub).includes('values'), 'players get links only');
  const raw = await call('GET /api/admin/social', boss);
  assert.strictEqual(raw.values.x, '@SabiNaija');
  ok('players see only the filled-in links; the admin sees what was typed');

  await call('PUT /api/admin/social', boss, { body: { x: '' } });
  assert.deepStrictEqual((await call('GET /api/social', null)).links, []);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'social.json')));
  ok('clearing a box hides it; settings are saved on the data folder');

  console.log(`\n${passed} social link checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
