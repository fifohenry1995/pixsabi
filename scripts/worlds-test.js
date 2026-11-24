'use strict';
// Run with: npm test (or: node scripts/worlds-test.js)
// Checks the two categories (Naija and Universal): separate levels, a separate puzzle pool, races inside one category.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-worlds-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PUZZLES_FILE = path.join(tmp, 'puzzles.json');
fs.copyFileSync(path.join(__dirname, '..', 'content', 'puzzles.json'), process.env.PUZZLES_FILE);
const { db, newUser } = require('../src/db');
const P = require('../src/puzzles');

const handlers = {};
const route = (m, p, h) => { handlers[`${m} ${p}`] = h; };
require('../src/routes/solo')({ route });
require('../src/routes/challenges')({ route });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { params = {}, body = {}, query = {} } = {}) => handlers[key]({ user: u, params, body, query, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

(async () => {
  const ada = user('Ada'), bola = user('Bola');
  const naija = P.puzzles.filter((p) => p.category === 'Naija').length;

  // ---- Universal is empty at first ----
  let r = await call('GET /api/solo/next', ada, { query: { category: 'Universal' } });
  assert.strictEqual(r.done, true); assert.strictEqual(r.empty, true); assert.strictEqual(r.total, 0);
  r = await call('GET /api/solo/next', ada, { query: { category: 'Naija' } });
  assert.ok(r.puzzle); assert.strictEqual(r.total, naija); assert.strictEqual(r.puzzle.category, 'Naija');
  r = await call('GET /api/solo/next', ada, { query: {} });
  assert.strictEqual(r.puzzle.category, 'Naija', 'no category means Naija');
  r = await call('GET /api/solo/next', ada, { query: { category: 'Food' } });
  assert.strictEqual(r.puzzle.category, 'Naija', 'old category names fall back to Naija');
  ok('Naija plays as before; Universal says it is empty until puzzles are added');

  // ---- add 25 Universal puzzles (like the admin page would) ----
  const list = JSON.parse(fs.readFileSync(process.env.PUZZLES_FILE, 'utf8'));
  const added = [];
  for (let i = 0; i < 25; i++) {
    const a = 'WORLD' + String.fromCharCode(65 + i);
    list.push({ a, c: 'Universal', t: ['🌍', '🌎', '🌏', '🗺️'], clue: 'c', fact: 'f' });
    added.push(a.toLowerCase());
  }
  fs.writeFileSync(process.env.PUZZLES_FILE, JSON.stringify(list));
  P.reload();
  const cats = P.categories();
  assert.deepStrictEqual(cats.map((c) => [c.name, c.count]), [['Naija', naija], ['Universal', 25]]);

  // ---- levels are separate ----
  const solve = async (u, cat) => {
    const x = await call('GET /api/solo/next', u, { query: { category: cat } });
    const p = P.fromPublic(x.puzzle.id);
    return call('POST /api/solo/guess', u, { body: { id: x.puzzle.id, guess: p.answer } });
  };
  let g = await solve(ada, 'Naija'); g = await solve(ada, 'Naija');
  assert.strictEqual(g.solvedCount, 2); assert.strictEqual(g.total, naija);
  g = await solve(ada, 'Universal');
  assert.strictEqual(g.solvedCount, 1, 'Universal has its own level counter'); assert.strictEqual(g.total, 25);
  let me = (await call('GET /api/solo/next', ada, { query: { category: 'Naija' } }));
  assert.strictEqual(me.solvedCount, 2);
  me = (await call('GET /api/solo/next', ada, { query: { category: 'Universal' } }));
  assert.strictEqual(me.solvedCount, 1); assert.strictEqual(me.puzzle.category, 'Universal');
  assert.ok(added.includes(P.fromPublic(me.puzzle.id).id), 'Universal levels come only from Universal puzzles');
  const { levelsOf } = require('../src/routes/solo');
  assert.deepStrictEqual(levelsOf(ada), { Naija: 3, Universal: 2 });
  assert.deepStrictEqual(levelsOf(bola), { Naija: 1, Universal: 1 });
  ok('Naija and Universal keep separate levels and separate puzzle pools');

  // ---- skipping stays inside the category ----
  ada.coins = 100;
  const cur = (await call('GET /api/solo/next', ada, { query: { category: 'Universal' } })).puzzle;
  await call('POST /api/solo/skip', ada, { body: { id: cur.id, category: 'Universal' } });
  const nxt = (await call('GET /api/solo/next', ada, { query: { category: 'Universal' } })).puzzle;
  assert.strictEqual(nxt.category, 'Universal'); assert.notStrictEqual(nxt.id, cur.id);
  ok('skipping stays inside the chosen category');

  // ---- races stay inside one category ----
  const id = (await call('POST /api/challenges', ada, { body: { category: 'Universal', levels: 20 } })).id;
  assert.ok(db.challenges[id].puzzleIds.every((pid) => P.byId.get(pid).category === 'Universal'));
  assert.strictEqual(db.challenges[id].category, 'Universal');
  await fails(400, () => call('POST /api/challenges', ada, { body: { category: 'Universal', levels: 26 } })); // only 25 exist
  const nid = (await call('POST /api/challenges', bola, { body: { category: 'Naija', levels: 20 } })).id;
  assert.ok(db.challenges[nid].puzzleIds.every((pid) => P.byId.get(pid).category === 'Naija'));
  ok('a race uses one category only, and cannot ask for more levels than the category has');

  console.log(`\nAll ${passed} category checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
