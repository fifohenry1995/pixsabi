'use strict';
// Run with: npm test (or: node scripts/wordsearch-test.js)
// Checks Word Search: the grids, finding words, hints, rewards, levels and the admin tools.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-ws-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORDSEARCH_FILE = path.join(tmp, 'wordsearch.json');
process.env.ADMIN_USER = 'boss';
fs.copyFileSync(path.join(__dirname, '..', 'content', 'wordsearch.json'), process.env.WORDSEARCH_FILE);

const { db, newUser } = require('../src/db');
const WS = require('../src/wordsearch');
const handlers = {};
const route = (m, p, h) => { handlers[`${m} ${p}`] = h; };
require('../src/routes/wordsearch')({ route });
require('../src/routes/admin')({ route });
require('../src/routes/challenges')({ route });
const call = (key, u, body = {}, params = {}) => handlers[key]({ user: u, params, body, query: {}, headers: {} });
const user = (n) => { const u = newUser(n, 'x'); db.users[u.id] = u; return u; };
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const rejects = async (fn, status) => { try { await fn(); } catch (e) { assert.strictEqual(e.status, status, e.message); return; } assert.fail('should have been refused'); };

// drag across a word the way a player would (optionally backwards)
const drag = (u, puzzle, word, back) => {
  const s = WS.grids(WS.byId(puzzle.id)).spots[word];
  const r2 = s.r + s.dr * (word.length - 1), c2 = s.c + s.dc * (word.length - 1);
  return call('POST /api/ws/select', u, back ? { id: puzzle.id, r1: r2, c1: c2, r2: s.r, c2: s.c } : { id: puzzle.id, r1: s.r, c1: s.c, r2, c2 });
};

(async () => {
  // ---- every starter puzzle has a grid with all its words in it ----
  assert.ok(WS.list.length >= 30);
  for (const e of WS.list) {
    const g = WS.grids(e);
    assert.ok(g.rows.every((r) => r.length === g.size) && g.rows.length === g.size);
    for (const w of e.words) {
      const s = g.spots[w];
      let t = ''; for (let i = 0; i < w.length; i++) t += g.rows[s.r + s.dr * i][s.c + s.dc * i];
      assert.strictEqual(t, w, `${e.id} ${w}`);
    }
  }
  assert.deepStrictEqual(WS.grids(WS.list[0]).rows, WS.grids(WS.list[0]).rows, 'same puzzle, same grid');
  ok('every starter puzzle builds, with all its words inside the grid');

  // ---- playing level 1 ----
  const ada = user('Ada');
  const st = call('GET /api/ws/state', ada);
  assert.strictEqual(st.puzzle.level, 1);
  assert.strictEqual(st.puzzle.id, WS.list[0].id);
  assert.ok(!JSON.stringify(st).includes('spots'));
  const p = st.puzzle, n = p.words.length;
  const miss = call('POST /api/ws/select', ada, { id: p.id, r1: 0, c1: 0, r2: 0, c2: 1 });
  assert.strictEqual(miss.found, false);
  assert.strictEqual(call('POST /api/ws/select', ada, { id: p.id, r1: 0, c1: 0, r2: 2, c2: 1 }).found, false, 'a crooked line finds nothing');
  assert.strictEqual(call('POST /api/ws/select', ada, { id: p.id, r1: -1, c1: 0, r2: 99, c2: 1 }).found, false);
  const first = drag(ada, p, p.words[0]);
  assert.strictEqual(first.found, true); assert.strictEqual(first.left, n - 1);
  assert.strictEqual(drag(ada, p, p.words[0]).found, false, 'a word counts once');
  const again = call('GET /api/ws/state', ada).puzzle;
  assert.strictEqual(again.found.length, 1, 'progress is kept when the player comes back');
  assert.strictEqual(again.secs, 0, 'a fresh level starts at 0 seconds');
  call('POST /api/ws/time', ada, { id: p.id, secs: 95 });
  assert.strictEqual(call('GET /api/ws/state', ada).puzzle.secs, 95, 'the time spent is kept when the player comes back');
  call('POST /api/ws/time', ada, { id: p.id, secs: 10 });
  assert.strictEqual(call('GET /api/ws/state', ada).puzzle.secs, 95, 'the time never goes backwards');
  call('POST /api/ws/time', ada, { id: 'not-this-one', secs: 500 });
  call('POST /api/ws/time', ada, { id: p.id, secs: 'abc' });
  assert.strictEqual(call('GET /api/ws/state', ada).puzzle.secs, 95, 'wrong id or junk is ignored');
  const back = drag(ada, p, p.words[1], true);
  assert.strictEqual(back.found, true, 'words can be dragged from the last letter');
  ok('finding words: wrong drags find nothing, progress is kept, backwards drags work');

  // ---- hints ----
  ada.coins = 100;
  const hl = call('POST /api/ws/hint', ada, { id: p.id, type: 'letter' });
  assert.strictEqual(ada.coins, 90); assert.ok(Number.isInteger(hl.r));
  assert.strictEqual(call('GET /api/ws/state', ada).puzzle.hinted.length, 1);
  const hw = call('POST /api/ws/hint', ada, { id: p.id, type: 'word' });
  assert.strictEqual(ada.coins, 60); assert.ok(hw.word);
  ada.coins = 5;
  await rejects(() => call('POST /api/ws/hint', ada, { id: p.id, type: 'word' }), 402);
  await rejects(() => call('POST /api/ws/hint', ada, { id: p.id, type: 'letter' }), 402);
  assert.strictEqual(ada.coins, 5, 'a refused hint costs nothing');
  ok('a letter hint costs 10 coins and a word hint 30, and never go below zero');

  // ---- finishing the level pays once and moves to level 2 ----
  const pts0 = ada.points, c0 = ada.coins;
  let last;
  for (const w of p.words) { const r = drag(ada, p, w); if (r.complete) { last = r; break; } }
  assert.ok(last && last.complete, 'the last word completes the level');
  assert.strictEqual(last.coins_earned, 10); assert.strictEqual(ada.coins, c0 + 10);
  assert.strictEqual(last.earned, 20 * n - 10 - 20, 'one first-letter hint (-10) and one revealed word (-20)');
  assert.strictEqual(ada.points, pts0 + last.earned);
  assert.strictEqual(last.level, 1);
  assert.strictEqual(call('GET /api/ws/state', ada).puzzle.level, 2);
  await rejects(() => call('POST /api/ws/select', ada, { id: p.id, r1: 0, c1: 0, r2: 0, c2: 1 }), 409);
  ok('finishing a level pays points and coins once and opens the next level');

  // ---- chest on every 10th level ----
  const bola = user('Bola');
  bola.ws = { done: {}, cur: null };
  WS.list.slice(0, 9).forEach((e) => { bola.ws.done[e.id] = 100; });
  const c1 = bola.coins;
  const pz = call('GET /api/ws/state', bola).puzzle;
  assert.strictEqual(pz.level, 10);
  let fin; for (const w of pz.words) { const r = drag(bola, pz, w); if (r.complete) { fin = r; break; } }
  assert.strictEqual(fin.chest.opened, 25); assert.strictEqual(bola.coins, c1 + 35);
  ok('level 10 opens a chest with 25 bonus coins');

  // ---- admin tools ----
  const boss = user('Boss');
  await rejects(() => call('GET /api/admin/wordsearch', ada), 404);
  await rejects(() => call('POST /api/admin/wordsearch', ada, { theme: 'x', words: 'LAGOS ABUJA KANO ENUGU' }), 404);
  const before = WS.list.length;
  await rejects(() => call('POST /api/admin/wordsearch', boss, { theme: '', words: 'LAGOS ABUJA KANO ENUGU' }), 400);
  await rejects(() => call('POST /api/admin/wordsearch', boss, { theme: 'T', words: 'LAGOS ABUJA' }), 400);
  await rejects(() => call('POST /api/admin/wordsearch', boss, { theme: 'T', words: 'LAGOS AB1 KANO ENUGU' }), 400);
  await rejects(() => call('POST /api/admin/wordsearch', boss, { theme: 'T', words: 'LAGOS AB KANO ENUGU' }), 400);
  const added = call('POST /api/admin/wordsearch', boss, { theme: 'My words', words: 'lagos, abuja, kano; enugu  ibadan', fact: 'Hello' });
  assert.strictEqual(added.levels.length, before + 1);
  const mine = added.levels[added.levels.length - 1];
  assert.deepStrictEqual(mine.words, ['LAGOS', 'ABUJA', 'KANO', 'ENUGU', 'IBADAN']);
  assert.ok(JSON.parse(fs.readFileSync(process.env.WORDSEARCH_FILE, 'utf8')).some((x) => x.theme === 'My words'), 'saved to the file');
  call('PUT /api/admin/wordsearch/:id', boss, { theme: 'Edited', words: 'LAGOS ABUJA KANO ENUGU' }, { id: mine.id });
  assert.strictEqual(WS.byId(mine.id).theme, 'Edited');
  // a player halfway through a level that the admin deletes is moved on without trouble
  const cy = user('Chidi');
  const cp = call('GET /api/ws/state', cy).puzzle;
  drag(cy, cp, cp.words[0]);
  call('DELETE /api/admin/wordsearch/:id', boss, {}, { id: cp.id });
  await rejects(() => call('POST /api/ws/select', cy, { id: cp.id, r1: 0, c1: 0, r2: 0, c2: 1 }), 409);
  const nx = call('GET /api/ws/state', cy).puzzle;
  assert.notStrictEqual(nx.id, cp.id); assert.strictEqual(nx.found.length, 0);
  call('DELETE /api/admin/wordsearch/:id', boss, {}, { id: mine.id });
  assert.strictEqual(WS.list.length, before - 1);
  ok('admin can add, edit and delete word searches; players on a deleted one are moved on');


  // ---- word search races ----
  const rich = user('Rich'), mid = user('Mid'), third = user('Third');
  rich.coins = 200; mid.coins = 200; third.coins = 200;
  const mk = (u, body) => call('POST /api/challenges', u, body);
  await rejects(() => mk(rich, { category: 'Word Search', levels: 2 }), 400);
  await rejects(() => mk(rich, { category: 'Word Search', levels: 9999 }), 400);
  const made = mk(rich, { category: 'Word Search', levels: 3, maxPlayers: 2 });
  const rid = made.id;
  const chal = db.challenges[rid];
  assert.strictEqual(chal.game, 'wordsearch'); assert.strictEqual(chal.puzzleIds.length, 3);
  assert.ok(chal.puzzleIds.every((id) => WS.byId(id)), 'the race holds word search ids');
  call('POST /api/challenges/join', mid, { code: rid });
  await rejects(() => call('POST /api/challenges/:id/start', mid, {}, { id: rid }), 403);
  call('POST /api/challenges/:id/start', rich, {}, { id: rid });
  const pre = call('GET /api/challenge-preview/:code', third, {}, { code: rid });
  assert.strictEqual(pre.game, 'wordsearch');
  const sv = call('GET /api/challenges/:id', rich, {}, { id: rid });
  assert.strictEqual(sv.game, 'wordsearch'); assert.ok(sv.wordsearch && !sv.puzzle);
  assert.strictEqual(sv.wordsearch.id, chal.puzzleIds[0]); assert.strictEqual(sv.round, 1);
  assert.ok(!JSON.stringify(sv).includes('spots'));
  await rejects(() => call('POST /api/challenges/:id/guess', rich, { guess: 'x' }, { id: rid }), 400);
  await rejects(() => call('POST /api/challenges/:id/skip', rich, {}, { id: rid }), 400);
  const sel = (u, entryId, word, back) => {
    const sp = WS.grids(WS.byId(entryId)).spots[word];
    const r2 = sp.r + sp.dr * (word.length - 1), c2 = sp.c + sp.dc * (word.length - 1);
    return call('POST /api/challenges/:id/ws-select', u, back ? { id: entryId, r1: r2, c1: c2, r2: sp.r, c2: sp.c } : { id: entryId, r1: sp.r, c1: sp.c, r2, c2 }, { id: rid });
  };
  assert.strictEqual(call('POST /api/challenges/:id/ws-select', rich, { id: chal.puzzleIds[0], r1: 0, c1: 0, r2: 0, c2: 1 }, { id: rid }).found, false);
  await rejects(() => call('POST /api/challenges/:id/ws-select', rich, { id: 'nope', r1: 0, c1: 0, r2: 0, c2: 1 }, { id: rid }), 409);
  const playLevel = (u, n, stopAt) => {
    const entry = WS.byId(chal.puzzleIds[n]); let last;
    entry.words.forEach((w, i) => { if (stopAt != null && i >= stopAt) return; last = sel(u, entry.id, w, i % 2 === 1); });
    return last;
  };
  // Mid gets one level done, then Rich races ahead
  const m1 = playLevel(mid, 0);
  assert.ok(m1.levelDone && m1.points === 20 * WS.byId(chal.puzzleIds[0]).words.length && !m1.finished);
  const prog = call('GET /api/challenges/:id/progress', rich, {}, { id: rid });
  assert.strictEqual(prog.players.find((p) => p.username === 'Mid').solved, 1, 'progress lanes count word searches done');
  // half way through level 1 the player keeps their words after reloading
  const halfEntry = WS.byId(chal.puzzleIds[0]);
  sel(rich, halfEntry.id, halfEntry.words[0]);
  assert.strictEqual(call('GET /api/challenges/:id', rich, {}, { id: rid }).wordsearch.found.length, 1);
  playLevel(rich, 0); // finishes level 1 (first word already found: harmless repeat)
  assert.strictEqual(call('GET /api/challenges/:id', rich, {}, { id: rid }).round, 2);
  playLevel(rich, 1);
  const raceFin = playLevel(rich, 2);
  assert.ok(raceFin.finished && raceFin.won, 'the third word search wins the race');
  assert.strictEqual(chal.status, 'finished'); assert.strictEqual(chal.winner, rich.id);
  assert.strictEqual(rich.coins, 200, 'no coins change hands in a race');
  assert.strictEqual(mid.coins, 200);
  const over = call('GET /api/challenges/:id', mid, {}, { id: rid });
  assert.strictEqual(over.me.done, true); assert.ok(over.results.me.length >= 1 && over.results.me[0].category === 'Word Search');
  await rejects(() => sel(mid, chal.puzzleIds[1], WS.byId(chal.puzzleIds[1]).words[0]), 409);
  ok('word search races: same word searches for everyone, live progress, first to finish wins, no hints or skipping');

  // a word search deleted by the admin mid-race counts as done, nobody gets stuck
  const r2id = mk(rich, { category: 'Word Search', levels: 3 }).id;
  call('POST /api/challenges/join', mid, { code: r2id });
  call('POST /api/challenges/:id/start', rich, {}, { id: r2id });
  const c2 = db.challenges[r2id];
  call('DELETE /api/admin/wordsearch/:id', boss, {}, { id: c2.puzzleIds[0] });
  const st2 = call('GET /api/challenges/:id', rich, {}, { id: r2id });
  assert.strictEqual(st2.wordsearch.id, c2.puzzleIds[1]); assert.strictEqual(st2.round, 2);
  ok('a word search deleted during a race is skipped for everybody');

  // the 3 day timeout counts word searches done
  c2.startedAt = Date.now() - 4 * 24 * 3600 * 1000;
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(c2.status, 'finished'); assert.strictEqual(c2.winner, rich.id, 'the player furthest ahead wins at the time limit');
  ok('word search races time out like the others');

  // ---- all levels finished ----
  const dan = user('Dan'); dan.ws = { done: {}, cur: null };
  WS.list.forEach((e) => { dan.ws.done[e.id] = 1; });
  assert.strictEqual(call('GET /api/ws/state', dan).done, true);
  ok('a player who finished every level sees the "all done" state');

  console.log(`\nAll ${passed} word search checks passed.`);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
