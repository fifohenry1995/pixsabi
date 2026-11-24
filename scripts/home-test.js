'use strict';
// Run with: npm test (or: node scripts/home-test.js)
// Checks the home screen data (streak week, level map) and the treasure chest every 10th level.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-home-'));
process.env.DATA_DIR = path.join(tmp, 'data');

const { db, newUser } = require('../src/db');
const P = require('../src/puzzles');

const handlers = {};
const route = (m, p, h) => { handlers[`${m} ${p}`] = h; };
require('../src/routes/solo')({ route });
require('../src/routes/daily')({ route });
const call = (key, u, body = {}, query = {}) => handlers[key]({ user: u, params: {}, body, query, headers: {} });
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

(async () => {
  const u = newUser('Ada', 'x'); db.users[u.id] = u;

  // ---- streak week ----
  let d = call('GET /api/daily', u);
  assert.strictEqual(d.week.length, 7);
  assert.ok(d.week[6].today && !d.week[6].done, 'today is last and not done yet');
  assert.strictEqual(d.week.filter((x) => x.done).length, 0);
  const yest = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
  u.daily.lastDate = yest(d.date, 1); u.daily.streak = 3; u.daily.best = 3;     // done 3 days ago... yesterday
  d = call('GET /api/daily', u);
  assert.deepStrictEqual(d.week.map((x) => x.done), [false, false, false, true, true, true, false]);
  assert.strictEqual(d.streak, 3);
  u.daily.lastDate = yest(d.date, 3);                                           // missed days: streak is broken
  d = call('GET /api/daily', u);
  assert.strictEqual(d.streak, 0);
  assert.ok(d.week.every((x) => !x.done));
  ok('the streak week marks the days of the current run and clears when a day is missed');

  // ---- level map data ----
  const m = call('GET /api/solo/map', u, {}, { category: 'Naija' });
  assert.strictEqual(m.category, 'Naija'); assert.strictEqual(m.solved, 0);
  assert.ok(m.total >= 10); assert.strictEqual(m.chestEvery, 10);
  assert.strictEqual(call('GET /api/solo/map', u, {}, { category: 'Nope' }).category, 'Naija');
  ok('the level map says how far you are and how many levels there are');

  // ---- chest every 10th level ----
  const naija = P.puzzles.filter((p) => p.category === 'Naija');
  const coins0 = u.coins;
  let last;
  for (let i = 0; i < 10; i++) {
    last = call('POST /api/solo/guess', u, { id: P.publicId(naija[i]), guess: naija[i].answer });
    assert.strictEqual(last.correct, true);
    if (i < 9) assert.strictEqual(last.chest.opened, 0, 'no chest before level 10');
  }
  assert.strictEqual(last.chest.opened, 25);
  assert.strictEqual(last.chest.toGo, 10);
  assert.strictEqual(last.coins_earned, 35);
  assert.strictEqual(u.coins, coins0 + 10 * 10 + 25);
  assert.strictEqual(call('GET /api/solo/map', u, {}, { category: 'Naija' }).solved, 10);
  const nxt = call('POST /api/solo/guess', u, { id: P.publicId(naija[10]), guess: naija[10].answer });
  assert.strictEqual(nxt.chest.opened, 0); assert.strictEqual(nxt.chest.toGo, 9);
  ok('every 10th level in a category opens a chest with 25 bonus coins; the count to the next chest is right');

  console.log(`\nAll ${passed} home checks passed.`);
  require('../src/db').flush();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nHOME TEST FAILED:', e.stack || e.message); process.exit(1); });
