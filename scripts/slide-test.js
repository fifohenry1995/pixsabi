'use strict';
// Run with: npm test (or: node scripts/slide-test.js)
// Checks the sliding puzzle: admin pictures, solo play (boards are solved for real), points and ranks, and races.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-slide-'));
fs.mkdirSync(path.join(tmp, 'images'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'content', 'puzzles.json'), path.join(tmp, 'puzzles.json'));
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, 'data'), PUZZLES_FILE: path.join(tmp, 'puzzles.json'), IMAGE_DIR: path.join(tmp, 'images'),
  ADS_DIR: path.join(tmp, 'ads'), LOGINBG_DIR: path.join(tmp, 'loginbg'), WORLDBG_DIR: path.join(tmp, 'worldbg'), POPUPS_DIR: path.join(tmp, 'popups'),
  SLIDE_FILE: path.join(tmp, 'slide.json'), SLIDE_DIR: path.join(tmp, 'slide'), WORDSEARCH_FILE: path.join(tmp, 'ws.json'), ADMIN_USER: 'boss',
});
const server = require('../src/app');
const SL = require('../src/slide');

const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]).toString('base64');
let base;
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, expect = 200) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expect, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

// Finds the slides that solve a 3x3 board (breadth-first search). Returns the list of positions to tap.
function solve3(board) {
  const key = (b) => b.join(',');
  const goal = key([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const seen = new Map([[key(board), null]]);
  let frontier = [board];
  while (frontier.length) {
    const next = [];
    for (const b of frontier) {
      if (key(b) === goal) {
        const out = []; let k = key(b);
        while (seen.get(k)) { const { from, pos } = seen.get(k); out.push(pos); k = from; }
        return out.reverse();
      }
      const gap = b.indexOf(8), r = Math.floor(gap / 3), c = gap % 3;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr > 2 || cc < 0 || cc > 2) continue;
        const pos = rr * 3 + cc, nb = b.slice();
        nb[gap] = nb[pos]; nb[pos] = 8;
        if (!seen.has(key(nb))) { seen.set(key(nb), { from: key(b), pos }); next.push(nb); }
      }
    }
    frontier = next;
  }
  throw new Error('no solution');
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const boss = new Client(), ada = new Client(), bola = new Client(), anon = new Client();
  await boss.call('POST', '/api/auth/register', { username: 'Boss', password: 'secret1', email: 'boss@example.com', adult: true });
  for (const [c, n] of [[ada, 'Ada'], [bola, 'Bola']]) await c.call('POST', '/api/auth/register', { username: n, password: 'secret1', email: n + '@example.com', adult: true });

  // ---- admin ----
  assert.deepStrictEqual((await ada.call('GET', '/api/sl/state')).empty, true, 'no puzzles yet');
  await ada.call('GET', '/api/admin/slide', null, 404);
  await ada.call('POST', '/api/admin/slide', { title: 'X', size: 3, image: JPEG }, 404);
  await boss.call('POST', '/api/admin/slide', { title: '', size: 3, image: JPEG }, 400);
  await boss.call('POST', '/api/admin/slide', { title: 'Bad size', size: 6, image: JPEG }, 400);
  await boss.call('POST', '/api/admin/slide', { title: 'No picture', size: 3 }, 400);
  await boss.call('POST', '/api/admin/slide', { title: 'Not a picture', size: 3, image: 'data:image/jpeg;base64,AAAA' }, 400);
  let out;
  for (const t of ['Zuma Rock', 'Jollof', 'Lagos', 'Eyo masquerade']) out = await boss.call('POST', '/api/admin/slide', { title: t, size: 3, fact: t === 'Zuma Rock' ? 'A big rock near Abuja.' : '', image: JPEG });
  assert.strictEqual(out.levels.length, 4);
  const first = out.levels[0];
  assert.ok(first.image && !first.missing);
  const img = await fetch(base + first.image);
  assert.strictEqual(img.status, 200); assert.strictEqual(img.headers.get('content-type'), 'image/jpeg');
  assert.strictEqual((await fetch(base + '/sl/s00000000')).status, 404);
  const edited = await boss.call('PUT', `/api/admin/slide/${first.id}`, { title: 'Zuma Rock, Abuja', size: 3, fact: 'A big rock near Abuja.' });
  assert.strictEqual(edited.levels[0].title, 'Zuma Rock, Abuja');
  ok('admin: add, validate, edit, serve pictures, admin only');

  // ---- solo ----
  const st = await ada.call('GET', '/api/sl/state');
  assert.strictEqual(st.puzzle.level, 1); assert.strictEqual(st.puzzle.size, 3);
  assert.ok(SL.validBoard(st.puzzle.board, 3) && !SL.isSolved(st.puzzle.board));
  assert.ok(!JSON.stringify(st).includes('"fact"'), 'the fun fact is not shown before the puzzle is solved');
  assert.deepStrictEqual((await ada.call('GET', '/api/sl/state')).puzzle.board, st.puzzle.board, 'same board after a reload');
  assert.strictEqual(st.puzzle.secs, 0);
  await ada.call('POST', '/api/sl/time', { id: st.puzzle.id, secs: 61 });
  assert.strictEqual((await ada.call('GET', '/api/sl/state')).puzzle.secs, 61, 'the time spent is kept when the player comes back');
  await ada.call('POST', '/api/sl/time', { id: st.puzzle.id, secs: 5 });
  assert.strictEqual((await ada.call('GET', '/api/sl/state')).puzzle.secs, 61, 'the time never goes backwards');
  const gap0 = st.puzzle.board.indexOf(8);
  const far = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((p) => Math.abs(Math.floor(p / 3) - Math.floor(gap0 / 3)) + Math.abs((p % 3) - (gap0 % 3)) > 1);
  assert.strictEqual((await ada.call('POST', '/api/sl/move', { id: st.puzzle.id, pos: far })).moved, false, 'only pieces next to the gap slide');
  await ada.call('POST', '/api/sl/move', { id: 'sdeadbeef', pos: 1 }, 409);
  const peek = await ada.call('POST', '/api/sl/peek', { id: st.puzzle.id });
  assert.strictEqual(peek.coins, st.coins - 5);
  require('../src/premium').grant(require('../src/db').db.users.ada); // fun facts are for Premium members
  let moves = solve3(st.puzzle.board), res;
  for (const pos of moves) res = await ada.call('POST', '/api/sl/move', { id: st.puzzle.id, pos });
  assert.ok(res.complete, 'the last slide finishes the level');
  assert.strictEqual(res.level, 1); assert.strictEqual(res.fact, 'A big rock near Abuja.');
  assert.strictEqual(res.moves, moves.length);
  const prof = (await ada.call('GET', '/api/players/Ada')).player;
  assert.strictEqual(prof.levels['Slide Puzzle'], 2, 'the profile shows the sliding puzzle level');
  assert.strictEqual(prof.levels['Word Search'], 1); assert.strictEqual(prof.levels.Naija, 1);
  assert.strictEqual((await ada.call('GET', '/api/me')).user.levels['Slide Puzzle'], 2);
  const par = SL.pointsFor(3, moves.length, 1);
  assert.strictEqual(res.earned, par, 'points: base, 1 peek, bonus for few slides');
  assert.ok(res.coins_earned >= 10);
  const next = await ada.call('GET', '/api/sl/state');
  assert.strictEqual(next.puzzle.level, 2, 'moves on to the next picture');
  ok('solo: real board solved, only legal slides, peek costs coins, points and next level');

  // ---- ranks ----
  const board = await ada.call('GET', '/api/leaderboard?board=slide');
  assert.ok(board.top.some((p) => p.username === 'Ada' && p.points === res.earned), 'on the Slide Puzzle board');
  assert.strictEqual((await ada.call('GET', '/api/leaderboard?board=wordsearch')).top.some((p) => p.username === 'Ada'), false);
  const me = await ada.call('GET', '/api/me');
  assert.ok(me.user.points >= res.earned, 'counts toward overall points');
  ok('ranks: Slide Puzzle board, overall points');

  // ---- races ----
  const mk = (c, body) => c.call('POST', '/api/challenges', body);
  await mk(ada, { category: 'Slide Puzzle', maxPlayers: 2, levels: 2 }).then(() => assert.fail('2 is too few'), () => {}).catch(() => {});
  const bad = await fetch(base + '/api/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ada.cookie }, body: JSON.stringify({ category: 'Slide Puzzle', maxPlayers: 2, levels: 2 }) });
  assert.strictEqual(bad.status, 400);
  const bad2 = await fetch(base + '/api/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ada.cookie }, body: JSON.stringify({ category: 'Slide Puzzle', maxPlayers: 2, levels: 9 }) });
  assert.strictEqual(bad2.status, 400, 'more than the pictures there are');
  const race = await mk(ada, { category: 'Slide Puzzle', maxPlayers: 4, levels: 3 });
  await bola.call('POST', '/api/challenges/join', { code: race.id });
  await ada.call('POST', `/api/challenges/${race.id}/start`, {});
  const sa = await ada.call('GET', `/api/challenges/${race.id}`), sb = await bola.call('GET', `/api/challenges/${race.id}`);
  assert.strictEqual(sa.game, 'slide'); assert.ok(sa.slide && !sa.puzzle);
  assert.deepStrictEqual(sa.slide.board, sb.slide.board, 'everybody gets the same shuffle');
  assert.ok(!JSON.stringify(sa).includes('A big rock'), 'no fun fact before solving');
  await ada.call('POST', `/api/challenges/${race.id}/guess`, { guess: 'x' }, 400);
  await ada.call('POST', `/api/challenges/${race.id}/skip`, {}, 400);
  await ada.call('POST', `/api/challenges/${race.id}/ws-select`, { id: sa.slide.id, r1: 0, c1: 0, r2: 0, c2: 1 }, 400);
  await ada.call('POST', `/api/challenges/${race.id}/sl-move`, { id: 'sdeadbeef', pos: 1 }, 409);
  // Bola solves one level, Ada solves all three and wins
  let s = sb;
  for (const pos of solve3(s.slide.board)) s.last = await bola.call('POST', `/api/challenges/${race.id}/sl-move`, { id: s.slide.id, pos });
  assert.ok(s.last.levelDone && s.last.finished === false);
  assert.ok((await ada.call('GET', `/api/challenges/${race.id}/progress`)).players.find((p) => p.username === 'Bola').solved === 1);
  s = sa; let last;
  for (let level = 0; level < 3; level++) {
    for (const pos of solve3(s.slide.board)) last = await ada.call('POST', `/api/challenges/${race.id}/sl-move`, { id: s.slide.id, pos });
    assert.ok(last.levelDone);
    if (level < 2) s = await ada.call('GET', `/api/challenges/${race.id}`);
  }
  assert.ok(last.finished && last.won, 'first to rebuild every picture wins');
  const end = await bola.call('GET', `/api/challenges/${race.id}`);
  assert.ok(end.status === 'finished' && end.winnerName === 'Ada', 'the race is over for Bola');
  await bola.call('POST', `/api/challenges/${race.id}/sl-move`, { id: 'sdeadbeef', pos: 1 }, 409);
  ok('race: create rules, same shuffle, no guess/skip, first to finish wins');

  // watching works for a slide race too
  const race2 = await mk(ada, { category: 'Slide Puzzle', maxPlayers: 3, levels: 3 });
  const watched = await boss.call('GET', `/api/watch/${race2.id}`);
  assert.strictEqual(watched.game, 'slide');
  ok('watch link works for sliding puzzle races');

  // ---- dashboard counts it ----
  const dash = await boss.call('GET', '/api/admin/dash?days=30');
  assert.ok(dash.games.playsInRange['Slide Puzzle'] >= 1 && dash.games.puzzles.some((p) => p.name === 'Slide Puzzle' && p.count === 4));
  ok('dashboard shows sliding puzzles');

  // ---- delete ----
  const gone = await boss.call('DELETE', `/api/admin/slide/${first.id}`);
  assert.strictEqual(gone.levels.length, 3);
  assert.strictEqual((await fetch(base + first.image)).status, 404);
  ok('admin: delete removes the picture');

  console.log(`\nAll ${passed} sliding puzzle checks passed.`);
  server.close(); process.exit(0);
})().catch((e) => { console.error('\nSLIDE TEST FAILED:', e.stack || e.message); process.exit(1); });
