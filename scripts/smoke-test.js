'use strict';
// Run with: npm test
// Boots the real server on a random port with a throwaway database, then plays
// the whole game with two users: sign up, solo, hints, daily, a challenge, ranks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-test-'));
const server = require('../src/app');
const puzzles = require('../content/puzzles.json');
const P = require('../src/puzzles');
// The browser only knows each puzzle by a random public id; this maps it back to the answer.
const answerOf = (publicId) => P.fromPublic(publicId).answer;

let base;
class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async call(method, url, body, expectStatus = 200) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    assert.strictEqual(res.status, expectStatus, `${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}

let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const ada = new Client('ada');
  const tunde = new Client('tunde');

  // static + security
  const home = await fetch(base + '/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.headers.get('content-security-policy'));
  for (const bad of ['/%2e%2e/package.json', '/%2e%2e/%2e%2e/etc/passwd', '/..%2fsrc/db.js', '/data/db.json', '/.secret']) {
    const r = await fetch(base + bad);
    assert.ok([403, 404].includes(r.status), `${bad} must be blocked, got ${r.status}`);
  }
  ok('serves the site with security headers and blocks path traversal');

  // Updates must reach players at once: scripts, styles and pages are always re-checked (never kept for an hour),
  // and an unchanged file costs only a tiny "304 not modified" answer.
  for (const f of ['/js/app.js', '/css/style.css', '/sw.js', '/']) {
    const r1 = await fetch(base + f);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.headers.get('cache-control'), 'no-cache', f + ' must be re-checked on every load');
    const tag = r1.headers.get('etag');
    if (f !== '/sw.js' && f !== '/') assert.ok(tag, f + ' needs an ETag');
    if (tag) assert.strictEqual((await fetch(base + f, { headers: { 'If-None-Match': tag } })).status, 304);
  }
  ok('app files are always re-checked, so updates show up immediately (ETag and 304)');

  // auth
  await ada.call('GET', '/api/me', null, 401);
  await ada.call('POST', '/api/auth/register', { username: 'a', password: 'secret1', email: 'a@example.com', adult: true }, 400);
  await ada.call('POST', '/api/auth/register', { username: 'Ada', password: '123', email: 'ada@example.com', adult: true }, 400);
  const reg = await ada.call('POST', '/api/auth/register', { username: 'Ada', password: 'secret1', email: 'ada@example.com', adult: true });
  assert.strictEqual(reg.user.username, 'Ada');
  assert.ok(!JSON.stringify(reg).includes('passHash'));
  await tunde.call('POST', '/api/auth/register', { username: 'ada', password: 'secret1', email: 'ada@example.com', adult: true }, 409);
  await tunde.call('POST', '/api/auth/register', { username: 'Tunde', password: 'secret2', email: 'tunde@example.com', adult: true });
  await new Client('x').call('POST', '/api/auth/login', { username: 'Ada', password: 'wrong' }, 401);
  const relog = new Client('ada2');
  await relog.call('POST', '/api/auth/login', { username: 'ADA', password: 'secret1' });
  ok('register, duplicate check, login (case-insensitive), no hash leaks');

  // CSRF-ish: non-JSON POST rejected
  const form = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=a&password=b' });
  assert.strictEqual(form.status, 415);
  ok('rejects non-JSON POSTs');

  // solo
  const next = await ada.call('GET', '/api/solo/next');
  const p = next.puzzle;
  // Every puzzle shows one collage picture, or (until you add it) four emoji tiles.
  assert.ok(p.image ? p.tiles == null : Array.isArray(p.tiles) && p.tiles.length === 4, 'puzzle needs a picture or 4 tiles');
  assert.ok(p.pool.length >= 12 && !('answer' in p));
  const answer = answerOf(p.id);
  assert.notStrictEqual(p.id, answer.toLowerCase(), 'the puzzle id sent to the browser must not be the answer');
  assert.ok(/^[0-9a-f]{16}$/.test(p.id));
  assert.strictEqual(p.length, answer.length);
  assert.ok(answer.split('').every((ch) => p.pool.includes(ch)), 'pool must contain every answer letter');
  const wrong = await ada.call('POST', '/api/solo/guess', { id: p.id, guess: 'ZZZZ' });
  assert.strictEqual(wrong.correct, false);
  const hint = await ada.call('POST', '/api/solo/hint', { id: p.id, type: 'letter' });
  assert.strictEqual(answer[hint.index], hint.letter);
  assert.strictEqual(hint.coins, 85);
  const clue = await ada.call('POST', '/api/solo/hint', { id: p.id, type: 'clue' });
  assert.ok(clue.clue && clue.coins === 80);
  const reload = await ada.call('GET', `/api/solo/next?category=${encodeURIComponent(p.category)}`);
  void reload;
  const right = await ada.call('POST', '/api/solo/guess', { id: p.id, guess: answer.toLowerCase() });
  assert.strictEqual(right.correct, true);
  assert.strictEqual(right.earned, 70); // 100 - 20 (letter) - 10 (clue)
  assert.strictEqual(right.coins, 90);
  await ada.call('POST', '/api/solo/guess', { id: p.id, guess: answer }, 409);
  ok('solo: hidden answers, wrong/right guesses, paid hints, scoring');

  // the same puzzle stays until it is solved or skipped (leaving the screen must not swap it)
  {
    const first = (await tunde.call('GET', '/api/solo/next')).puzzle;
    const again = (await tunde.call('GET', '/api/solo/next')).puzzle;
    assert.strictEqual(again.id, first.id, 'reopening Play must show the same puzzle');
    const paid = await tunde.call('POST', '/api/solo/hint', { id: first.id, type: 'letter' });
    const afterHint = (await tunde.call('GET', '/api/solo/next')).puzzle;
    assert.strictEqual(afterHint.id, first.id);
    assert.strictEqual(Object.keys(afterHint.revealed).length, 1, 'a paid letter stays revealed');
    assert.strictEqual(afterHint.revealed[paid.index], paid.letter);
    const other = (await tunde.call('GET', `/api/solo/next?category=${encodeURIComponent(first.category)}`)).puzzle;
    const backToAll = (await tunde.call('GET', '/api/solo/next')).puzzle;
    assert.strictEqual(backToAll.id, first.id, 'changing category and back keeps the puzzle');
    void other;
    const coinsBefore = (await tunde.call('GET', '/api/me')).user.coins;
    await tunde.call('GET', `/api/solo/next?skip=${first.id}`);                                    // the old free-skip trick no longer works
    assert.strictEqual((await tunde.call('GET', '/api/solo/next')).puzzle.id, first.id, 'a URL cannot skip for free');
    await tunde.call('POST', '/api/solo/skip', { id: first.id, category: 'Nope' }, 400);            // only Naija or Universal exist
    const sk = await tunde.call('POST', '/api/solo/skip', { id: first.id, category: '' });
    assert.strictEqual(sk.coins, coinsBefore - 20, 'skip costs 20 coins');
    const skipped = (await tunde.call('GET', '/api/solo/next')).puzzle;
    assert.notStrictEqual(skipped.id, first.id, 'skip must give a different puzzle');
    assert.strictEqual((await tunde.call('GET', '/api/solo/next')).puzzle.id, skipped.id, 'and then that one stays');
    const answer = P.fromPublic(skipped.id).answer;
    assert.strictEqual((await tunde.call('POST', '/api/solo/guess', { id: skipped.id, guess: answer })).correct, true);
    const afterSolve = (await tunde.call('GET', '/api/solo/next')).puzzle;
    assert.notStrictEqual(afterSolve.id, skipped.id, 'after solving, a new puzzle comes up');
    assert.strictEqual((await tunde.call('GET', '/api/solo/next')).puzzle.id, afterSolve.id);
    require('../src/db').db.users.tunde.coins = 5;
    const cur = (await tunde.call('GET', '/api/solo/next')).puzzle;
    await tunde.call('POST', '/api/solo/skip', { id: cur.id, category: '' }, 402);                 // not enough coins
    assert.strictEqual((await tunde.call('GET', '/api/solo/next')).puzzle.id, cur.id, 'a refused skip keeps the puzzle');
    ok('solo: the same puzzle stays across reloads, hints and category changes until solved or skipped');
  }

  // daily
  const d = await ada.call('GET', '/api/daily');
  assert.strictEqual(d.solved, false);
  const dAnswer = answerOf(d.puzzle.id);
  assert.strictEqual((await ada.call('POST', '/api/daily/guess', { guess: 'NOPE' })).correct, false);
  const dr = await ada.call('POST', '/api/daily/guess', { guess: dAnswer });
  assert.strictEqual(dr.correct, true);
  assert.strictEqual(dr.streak, 1);
  assert.strictEqual((await ada.call('GET', '/api/daily')).solved, true);
  const again = await ada.call('POST', '/api/daily/guess', { guess: dAnswer });
  assert.strictEqual(again.already, true);
  ok('daily puzzle and streak (no double rewards)');

  // challenges
  await ada.call('POST', '/api/challenges', { opponent: 'ghost' }, 404);
  await ada.call('POST', '/api/challenges', { opponent: 'ada' }, 400);
  const search = await ada.call('GET', '/api/users/search?q=tu');
  assert.deepStrictEqual(search.users, ['Tunde']);
  const created = await ada.call('POST', '/api/challenges', { opponent: 'tunde', category: 'Naija' });
  const id = created.id;
  const stranger = new Client('stranger');
  await stranger.call('POST', '/api/auth/register', { username: 'Stranger', password: 'secret3', email: 'stranger@example.com', adult: true });
  await stranger.call('POST', '/api/challenges/join', { code: id }, 403);
  await stranger.call('GET', `/api/challenges/${id}`, null, 403);
  await tunde.call('POST', '/api/challenges/join', { code: id.toLowerCase() });

  // Race: the host starts it, then both play at once. Tunde skips once and gets a wrong guess; Ada wins.
  await ada.call('POST', `/api/challenges/${id}/guess`, { guess: 'X' }, 409); // not started yet
  const lobby = await ada.call('GET', `/api/challenges/${id}`);
  assert.strictEqual(lobby.started, false);
  assert.strictEqual(lobby.rounds, 20);
  await tunde.call('POST', `/api/challenges/${id}/start`, null, 403);
  await ada.call('POST', `/api/challenges/${id}/start`);

  async function solveOne(client) {
    const s = await client.call('GET', `/api/challenges/${id}`);
    assert.ok(!('answer' in s.puzzle));
    assert.strictEqual((await client.call('POST', `/api/challenges/${id}/guess`, { guess: 'QQQQ' })).correct, false);
    const g = await client.call('POST', `/api/challenges/${id}/guess`, { guess: answerOf(s.puzzle.id) });
    assert.strictEqual(g.correct, true);
    assert.ok(g.points >= 20 && g.points <= 95, `points ${g.points}`);
    return g;
  }
  const sk = await tunde.call('POST', `/api/challenges/${id}/skip`);
  assert.strictEqual(sk.points, -10); // skipping costs 10 points
  for (let i = 0; i < 5; i++) await solveOne(tunde);
  for (let i = 0; i < 19; i++) await solveOne(ada);
  const mid = await ada.call('GET', `/api/challenges/${id}`);
  assert.strictEqual(mid.status, 'active');
  assert.strictEqual(mid.me.solved, 19);
  const last = await solveOne(ada);
  assert.strictEqual(last.won, true);
  const adaEnd = await ada.call('GET', `/api/challenges/${id}`);
  const tundeEnd = await tunde.call('GET', `/api/challenges/${id}`);
  assert.strictEqual(adaEnd.status, 'finished');
  assert.strictEqual(adaEnd.winner, 'me');
  assert.strictEqual(tundeEnd.winner, 'opponent');
  assert.strictEqual(adaEnd.results.opponent.length, 6, 'five solves plus the skip');
  assert.strictEqual(adaEnd.results.opponent[0].points, -10, 'the skipped level shows the penalty');
  await tunde.call('POST', `/api/challenges/${id}/guess`, { guess: 'X' }, 409); // race is over
  const adaList = await ada.call('GET', '/api/challenges');
  assert.strictEqual(adaList.challenges[0].result, 'won');
  ok('challenge: invite-only, join, host starts, 20-level race, skip, first to finish wins, stats');

  // leaderboard + profile
  const lb = await ada.call('GET', '/api/leaderboard');
  assert.strictEqual(lb.top[0].username, 'Ada');
  assert.strictEqual(lb.me.rank, 1);
  const me = await ada.call('GET', '/api/me');
  assert.strictEqual(me.user.stats.won, 1);
  assert.strictEqual(me.user.streak, 1);
  ok('leaderboard and profile stats');

  // answers must never reach the browser before the puzzle is solved
  {
    const answers = puzzles.map((q) => q.a);
    const hasAnswer = (text) => answers.filter((a) => a.length >= 5 && text.toUpperCase().includes(a));
    const seen = [];
    let last = '';
    require('../src/db').db.users.tunde.coins = 9999;
    for (let i = 0; i < 8; i++) {
      const j = await tunde.call('GET', '/api/solo/next');
      seen.push(JSON.stringify(j)); last = j.puzzle.id;
      seen.push(JSON.stringify(await tunde.call('POST', '/api/solo/skip', { id: last, category: '' }))); // skip forward so each pass looks at a fresh puzzle
    }
    seen.push(JSON.stringify(await tunde.call('GET', '/api/daily')));
    for (const body of seen) {
      const j = JSON.parse(body);
      const pz = j.puzzle;
      if (!pz) continue;
      assert.deepStrictEqual(hasAnswer(JSON.stringify({ ...pz, pool: undefined })), [], 'a puzzle response contains an answer');
      assert.ok(!pz.image || /^\/pic\/[0-9a-f]{16}\?v=\d+$/.test(pz.image), 'picture link must be /pic/<random id>');
      assert.notStrictEqual(pz.id, P.fromPublic(pz.id).id, 'real id leaked');
    }
    // the old public pictures folder is never served, whatever it contains
    for (const url of ['/images/', '/images/jollof.jpg', '/images/JOLLOF.JPG', '/images/%2e%2e/package.json', '/content/puzzles.json', '/content/images/jollof.jpg']) {
      assert.strictEqual((await fetch(base + url)).status === 200, false, `${url} must not be served`);
    }
    // pictures: logged-in players only, by random id only
    const withPic = seen.map((b) => JSON.parse(b).puzzle).find((pz) => pz && pz.image);
    if (withPic) {
      const noLogin = await fetch(base + withPic.image);
      assert.strictEqual(noLogin.status, 401);
      const img = await fetch(base + withPic.image, { headers: { Cookie: tunde.cookie } });
      assert.strictEqual(img.status, 200);
      assert.ok(/^image\//.test(img.headers.get('content-type')));
      assert.ok(!/filename/i.test(img.headers.get('content-disposition') || ''), 'no file name may be sent');
    }
    const realId = answerOf(seen.map((b) => JSON.parse(b).puzzle).find(Boolean).id).toLowerCase();
    for (const bad of [`/pic/${realId}`, '/pic/0000000000000000', '/pic/..%2f..%2fpackage.json', '/pic/']) {
      const r = await fetch(base + bad, { headers: { Cookie: tunde.cookie } });
      assert.ok(r.status !== 200, `${bad} must not be served`);
    }
    // the real id (the answer) is not accepted by the API either
    const realPuzzle = P.puzzles[0];
    await tunde.call('POST', '/api/solo/guess', { id: realPuzzle.id, guess: realPuzzle.answer }, 404);
    await tunde.call('POST', '/api/solo/hint', { id: realPuzzle.id, type: 'clue' }, 404);
    ok('answers, real ids and picture file names never reach players; pictures need login');
  }

  // rate limit on auth
  const spam = new Client('spam');
  let blocked = false;
  for (let i = 0; i < 40 && !blocked; i++) {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nobody', password: 'x' }) });
    if (r.status === 429) blocked = true;
  }
  assert.ok(blocked, 'login attempts must be rate limited');
  ok('login attempts are rate limited');
  void spam;

  console.log(`\nAll ${passed} checks passed.`);
  server.close();
  require('../src/db').flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('\nSMOKE TEST FAILED:', e.message);
  process.exit(1);
});
