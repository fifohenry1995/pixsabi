'use strict';
// Run with: npm test (or: node scripts/group-test.js)
// Checks races (2 to 20 players, 20+ levels, first to finish wins) by calling the challenge handlers directly
// against a throwaway database: lobby limits, locking, ranking, ties and stats.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-group-'));
const dbm = require('../src/db');
const { db, newUser } = dbm;
const P = require('../src/puzzles');

const handlers = {};
require('../src/routes/challenges')({
  route: (method, pattern, handler) => { handlers[`${method} ${pattern}`] = handler; },
});

const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { params = {}, body = {}, query = {} } = {}) =>
  handlers[key]({ user: u, params, body, query, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}

// Staking was removed from the game: the server ignores stake/split. A few checks below still build an OLD staked race
// (as one created before the change) to prove that refunds and payouts of such races keep working.
const create = async (u, body = {}) => {
  const { stake, split, ...rest } = body;
  const id = (await call('POST /api/challenges', u, { body: rest })).id;
  if (stake > 0) { const ch = db.challenges[id]; u.coins -= stake; ch.stake = stake; ch.pot = stake; ch.players[u.id].staked = stake; if (split) ch.split = split; }
  return id;
};
const join = (u, id) => call('POST /api/challenges/join', u, { body: { code: id } });
const countOf = (id) => Object.keys(db.challenges[id].players).length;
const state = (u, id) => call('GET /api/challenges/:id', u, { params: { id } });

const LEVELS = 20;
const start = (u, id) => call('POST /api/challenges/:id/start', u, { params: { id } });
const guess = (u, id, g) => call('POST /api/challenges/:id/guess', u, { params: { id }, body: { guess: g } });

// Clears `count` levels (all of them when omitted). wrongFirst = wrong guesses on the first level.
async function play(u, id, { count = LEVELS, wrongFirst = 0 } = {}) {
  let last;
  for (let n = 0; n < count; n++) {
    const s = await state(u, id);
    assert.ok(!('answer' in s.puzzle), 'answers must stay on the server');
    if (n === 0) for (let i = 0; i < wrongFirst; i++) assert.strictEqual((await guess(u, id, 'QQQQ')).correct, false);
    last = await guess(u, id, P.fromPublic(s.puzzle.id).answer);
    assert.strictEqual(last.correct, true);
  }
  return last;
}

let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

(async () => {
  const ada = user('Ada'), bola = user('Bola'), chidi = user('Chidi'), dayo = user('Dayo'), efe = user('Efe');

  // ---- creating ----
  for (const bad of [1, 21, 0, 'abc', 2.5]) await fails(400, () => create(ada, { maxPlayers: bad }));
  for (const bad of [5, 19, 0, -20, 'abc', 20.5]) await fails(400, () => create(ada, { levels: bad }));
  await fails(400, () => create(ada, { levels: P.puzzles.length + 1 }));
  await fails(400, () => create(ada, { maxPlayers: 4, opponent: 'bola' }));
  const dflt = await create(ada);
  assert.strictEqual((await state(ada, dflt)).rounds, 20, 'default is 20 levels');
  for (const n of [20, 50, 100]) {
    const id = await create(ada, { levels: n });
    assert.strictEqual(db.challenges[id].puzzleIds.length, n);
    assert.strictEqual(new Set(db.challenges[id].puzzleIds).size, n, 'no puzzle appears twice');
    assert.strictEqual((await state(ada, id)).rounds, n);
  }
  const all = await create(ada, { levels: P.puzzles.length });
  assert.strictEqual(db.challenges[all].puzzleIds.length, P.puzzles.length);
  // there are two categories only; Universal cannot be raced until it has 20 puzzles
  assert.deepStrictEqual(P.categories().map((c) => c.name), ['Naija', 'Universal']);
  assert.ok(P.puzzles.every((p) => p.category === 'Naija' || p.category === 'Universal'));
  const uni = P.categories().find((c) => c.name === 'Universal').count;
  if (uni < 20) await fails(400, () => create(ada, { category: 'Universal', levels: 20 }));
  await fails(400, () => create(ada, { category: 'Food', levels: 20 }));
  ok('players pick 20 or more levels (up to every puzzle); too few or too many is refused');

  // ---- the category is shown before joining ----
  const naijaRace = await create(ada, { category: 'Naija', levels: 20 });
  const pvw = await call('GET /api/challenge-preview/:code', bola, { params: { code: naijaRace } });
  assert.strictEqual(pvw.category, 'Naija');
  assert.strictEqual(pvw.inCategory, 20);
  assert.strictEqual(pvw.rounds, 20);
  assert.strictEqual(pvw.stake, 0);
  assert.strictEqual(pvw.host, 'Ada');
  assert.strictEqual((await state(ada, naijaRace)).category, 'Naija');
  assert.strictEqual((await call('GET /api/challenges', ada)).challenges.find((c) => c.id === naijaRace).category, 'Naija');
  const blankRace = await create(ada, { levels: 20 });
  assert.strictEqual(db.challenges[blankRace].category, 'Naija', 'no category chosen means Naija');
  ok('the category is shown before joining');

  // ---- lobby: nobody can play until the host starts ----
  const duel = await create(ada, { levels: 20 });
  const lobby = await state(ada, duel);
  assert.strictEqual(lobby.started, false);
  assert.strictEqual(lobby.puzzle, undefined);
  assert.strictEqual(lobby.canStart, false, 'need a second player first');
  await fails(409, () => guess(ada, duel, 'x'));
  await fails(400, () => start(ada, duel));
  await join(bola, duel);
  await fails(409, () => join(chidi, duel));
  assert.strictEqual((await state(ada, duel)).canStart, true);
  assert.strictEqual((await state(bola, duel)).canStart, false);
  await fails(403, () => start(bola, duel));
  await fails(409, () => guess(bola, duel, 'x'));
  await start(ada, duel);
  await fails(409, () => join(chidi, duel));
  assert.ok((await state(bola, duel)).puzzle, 'both players get puzzles once started');
  ok('lobby: players join, only the host can start, nobody plays before the start');

  // ---- watching a race from a shared link ----
  const watch = (u, id) => call('GET /api/watch/:code', u, { params: { code: id } });
  const w1 = await watch(chidi, duel);                                          // not in the race, but has an account
  assert.strictEqual(w1.participant, false);
  assert.strictEqual(w1.watching, 1);
  assert.deepStrictEqual(w1.players.map((p) => p.username).sort(), ['Ada', 'Bola']);
  assert.ok(!/puzzle|answer|pool|image/i.test(Object.keys(w1).join(',') + Object.keys(w1.players[0]).join(',')), 'watchers never get puzzles or answers');
  await watch(chidi, duel);
  assert.strictEqual((await watch(dayo, duel)).watching, 2, 'each watcher counts once');
  assert.strictEqual((await call('GET /api/challenges/:id/progress', ada, { params: { id: duel } })).watching, 2, 'racers see the count');
  assert.strictEqual((await state(ada, duel)).watching, 2);
  assert.deepStrictEqual(await watch(ada, duel), { id: duel, participant: true }, 'racers are sent to their own race screen');
  assert.strictEqual((await call('GET /api/challenges/:id/progress', ada, { params: { id: duel } })).watching, 2, 'racers do not count as watchers');
  await fails(404, () => watch(chidi, 'ZZZZZZ'));
  ok('watch link: any player with an account can watch, counted once, no puzzles or answers shown, racers see the count');

  // ---- first to clear every level wins, and the race ends on the spot ----
  await play(bola, duel, { count: 10 });
  let prog = await call('GET /api/challenges/:id/progress', ada, { params: { id: duel } });
  assert.strictEqual(prog.finished, false);
  assert.deepStrictEqual(prog.players.map((p) => [p.username, p.solved]), [['Ada', 0], ['Bola', 10]]);
  await play(ada, duel, { count: 20, wrongFirst: 2 }); // Ada is slower per level but clears all 20 first
  const endA = await state(ada, duel);
  assert.strictEqual(endA.status, 'finished');
  assert.strictEqual(endA.winner, 'me');
  assert.strictEqual(endA.winnerName, 'Ada');
  assert.strictEqual(endA.me.solved, 20);
  const endB = await state(bola, duel);
  assert.strictEqual(endB.winner, 'opponent');
  assert.strictEqual(endB.me.solved, 10);
  assert.strictEqual(endB.me.done, true, 'the race is over for the loser too');
  assert.strictEqual(endB.puzzle, undefined);
  await fails(409, () => guess(bola, duel, 'x'));
  await fails(409, () => call('POST /api/challenges/:id/skip', bola, { params: { id: duel } }));
  assert.strictEqual(ada.stats.won, 1);
  assert.strictEqual(bola.stats.lost, 1);
  assert.strictEqual(ada.stats.played, 1);
  const row = (await call('GET /api/challenges', bola)).challenges.find((c) => c.id === duel);
  assert.strictEqual(row.result, 'lost');
  assert.strictEqual(row.rounds, 20);
  assert.strictEqual(row.mySolved, 10);
  ok('first player to clear all levels wins; the race ends and the other player stops');

  // ---- a skipped level costs 10 and comes back, so it cannot be used to finish ----
  const sk = await create(ada, { levels: 20 });
  await join(bola, sk);
  await start(ada, sk);
  const first = await state(ada, sk);
  const skipped = await call('POST /api/challenges/:id/skip', ada, { params: { id: sk } });
  assert.strictEqual(skipped.points, -10);
  assert.strictEqual(skipped.comesBack, true);
  const second = await state(ada, sk);
  assert.notStrictEqual(second.puzzle.id, first.puzzle.id, 'next level is a different one');
  assert.strictEqual(second.round, 1, 'a skip does not count as progress');
  for (let i = 0; i < 18; i++) {
    const s = await state(ada, sk);
    await guess(ada, sk, P.fromPublic(s.puzzle.id).answer);
  }
  let near = await state(ada, sk);
  assert.strictEqual(near.status, 'active');
  assert.strictEqual(near.round, 19, 'on the 19th of 20 levels');
  await guess(ada, sk, P.fromPublic(near.puzzle.id).answer);
  near = await state(ada, sk);
  assert.strictEqual(near.status, 'active', 'cannot finish while a skipped level is outstanding');
  assert.strictEqual(P.fromPublic(near.puzzle.id).answer, P.byId.get(db.challenges[sk].puzzleIds[0]).answer, 'the skipped level is back');
  const fin = await guess(ada, sk, P.fromPublic(near.puzzle.id).answer);
  assert.strictEqual(fin.finished, true);
  assert.strictEqual(fin.won, true);
  const skEnd = await state(bola, sk);
  assert.strictEqual(skEnd.status, 'finished');
  assert.strictEqual(skEnd.results.others.length, 1);
  const adaRows = (await state(ada, sk)).results.me;
  assert.strictEqual(adaRows.length, 21, '20 solves plus 1 skip');
  assert.strictEqual(adaRows.filter((r) => !r.solved).length, 1);
  assert.ok(adaRows.every((r) => r.answer && r.answer !== '(puzzle removed)'));
  ok('skip costs 10 points, the level comes back, and you still have to solve it');

  // ---- group of 4: full lobby, host starts, one winner, everyone ranked by levels cleared ----
  const g4 = await create(ada, { maxPlayers: 4, levels: 20 });
  await join(bola, g4);
  await join(chidi, g4);
  await join(dayo, g4);
  await fails(409, () => join(efe, g4));
  await fails(403, () => state(efe, g4));
  assert.strictEqual((await state(ada, g4)).started, false, 'a full race still waits for the host to start');
  await start(ada, g4);
  await play(bola, g4, { count: 12 });
  await play(chidi, g4, { count: 15 });
  await play(dayo, g4, { count: 3 });
  await play(ada, g4);
  const e = await state(ada, g4);
  assert.strictEqual(e.status, 'finished');
  assert.deepStrictEqual(e.players.map((p) => p.username), ['Ada', 'Chidi', 'Bola', 'Dayo']);
  assert.strictEqual(e.place, 1);
  assert.strictEqual((await state(chidi, g4)).place, 2);
  assert.strictEqual((await state(bola, g4)).place, 3);
  assert.strictEqual((await state(dayo, g4)).place, 4);
  assert.strictEqual((await state(dayo, g4)).winnerName, 'Ada');
  assert.strictEqual(ada.stats.won, 3);
  assert.strictEqual(dayo.stats.lost, 1);
  ok('group race: first to finish wins, the rest are ranked by levels cleared');

  // ---- big races work for a full group of 8 ----
  const big = [ada, bola, chidi, dayo, efe, user('Fola'), user('Gozie'), user('Hauwa')];
  const g8 = await create(ada, { maxPlayers: 8, levels: 100 });
  for (const u of big.slice(1)) await join(u, g8);
  assert.strictEqual((await state(ada, g8)).playerCount, 8);
  await start(ada, g8);
  await play(big[7], g8, { count: 100 });
  const bigEnd = await state(ada, g8);
  assert.strictEqual(bigEnd.status, 'finished');
  assert.strictEqual(bigEnd.winnerName, 'Hauwa');
  assert.strictEqual(bigEnd.players.length, 8);
  ok('100-level race with 8 players');

  // ---- points: everyone keeps what they scored, nobody loses overall points ----
  const f = user('Fresh'), g = user('Gold');
  const pf = f.points, pg = g.points;
  const pr = await create(f, { levels: 20 });
  await join(g, pr);
  await start(f, pr);
  await call('POST /api/challenges/:id/skip', g, { params: { id: pr } }); // Gold is on -10
  await play(f, pr);
  assert.ok(f.points > pf, 'the winner earned points');
  assert.strictEqual(g.points, pg, 'a negative score never lowers overall points');
  ok('points are added at the end of a race and never go down');

  // ---- staking is gone: the server ignores any stake an old app sends ----
  { const x = user('Nostake'); const before = x.coins; const id = (await call('POST /api/challenges', x, { body: { levels: 20, stake: 50, split: 'top3', maxPlayers: 12 } })).id;
    assert.strictEqual(x.coins, before, 'no coins are taken'); assert.strictEqual((await state(x, id)).stake, 0); assert.ok(!db.challenges[id].pot);
    ok('stakes are ignored: no coins are taken when creating a race'); }
  // ---- coin stakes (races that were created before staking was removed) ----
  const rich = user('Rich'), mid = user('Mid'), poor = user('Poor'), late = user('Late');
  poor.coins = 5;
  const c0 = { rich: rich.coins, mid: mid.coins };
  const sg = await create(rich, { maxPlayers: 4, levels: 20, stake: 50 });
  assert.strictEqual(rich.coins, c0.rich - 50, 'the host pays the stake when creating');
  assert.strictEqual((await state(rich, sg)).pot, 50);
  const pv = await call('GET /api/challenge-preview/:code', mid, { params: { code: sg.toLowerCase() } });
  assert.strictEqual(pv.stake, 50);
  assert.strictEqual(pv.alreadyIn, false);
  assert.strictEqual(mid.coins, c0.mid, 'looking at the invite costs nothing');
  await fails(402, () => join(poor, sg));
  assert.strictEqual(poor.coins, 5);
  assert.strictEqual(countOf(sg), 1, 'a player who cannot pay is not added');
  await join(mid, sg);
  await join(mid, sg); // joining twice must not charge twice
  assert.strictEqual(mid.coins, c0.mid - 50);
  assert.strictEqual((await state(rich, sg)).pot, 100);
  assert.strictEqual((await state(mid, sg)).stake, 50);
  ok('stakes: host and joiners pay once, players who cannot afford it are turned away');

  // leaving the lobby refunds you; the host cannot leave but can cancel
  await join(late, sg);
  assert.strictEqual((await state(rich, sg)).pot, 150);
  await call('POST /api/challenges/:id/leave', late, { params: { id: sg } });
  assert.strictEqual(late.coins, 100, 'leaving gives the stake back');
  assert.strictEqual((await state(rich, sg)).pot, 100);
  await fails(403, () => state(late, sg));
  await fails(400, () => call('POST /api/challenges/:id/leave', rich, { params: { id: sg } }));
  await fails(403, () => call('POST /api/challenges/:id/cancel', mid, { params: { id: sg } }));
  ok('leaving a lobby refunds the stake; only the host can cancel');

  // winner takes the whole pot
  await start(rich, sg);
  await fails(409, () => call('POST /api/challenges/:id/cancel', rich, { params: { id: sg } }));
  await fails(409, () => call('POST /api/challenges/:id/leave', mid, { params: { id: sg } }));
  await play(mid, sg, { count: 5 });
  await play(rich, sg);
  assert.strictEqual(rich.coins, c0.rich - 50 + 100, 'the winner takes the whole pot');
  assert.strictEqual(mid.coins, c0.mid - 50, 'the loser keeps no refund once the race has started');
  const sEnd = await state(rich, sg);
  assert.strictEqual(sEnd.pot, 100);
  assert.strictEqual(sEnd.youStaked, 50);
  assert.strictEqual((await state(mid, sg)).youStaked, 50);
  const totalNow = rich.coins + mid.coins;
  assert.strictEqual(totalNow, c0.rich + c0.mid, 'no coins appear or vanish');
  ok('winner takes the whole pot, nothing is refunded after the start, no coins are created or lost');

  // host cancels: everybody is refunded, only once
  const cx = await create(rich, { levels: 20, stake: 20 });
  await join(mid, cx);
  const rb = rich.coins, mb = mid.coins;
  await call('POST /api/challenges/:id/cancel', rich, { params: { id: cx } });
  assert.strictEqual(rich.coins, rb + 20);
  assert.strictEqual(mid.coins, mb + 20);
  assert.strictEqual((await state(rich, cx)).cancelled, true);
  await fails(409, () => call('POST /api/challenges/:id/cancel', rich, { params: { id: cx } }));
  await fails(409, () => join(late, cx));
  await fails(409, () => start(rich, cx));
  assert.strictEqual(db.challenges[cx].startedAt, null, 'a cancelled race can never be started');
  assert.strictEqual(rich.coins, rb + 20, 'refunded only once');
  assert.strictEqual((await call('GET /api/challenges', rich)).challenges.find((c) => c.id === cx).status, 'cancelled');
  ok('cancelling a race refunds everyone exactly once');

  // nobody starts it for 24 hours: refunded automatically
  const ab = await create(rich, { levels: 20, stake: 30 });
  await join(mid, ab);
  const rb2 = rich.coins, mb2 = mid.coins;
  await call('GET /api/challenges', rich);
  assert.strictEqual(rich.coins, rb2, 'a fresh lobby is not refunded');
  db.challenges[ab].createdAt = Date.now() - 25 * 3600 * 1000;
  dbm.flush();
  await call('GET /api/challenges', rich);
  assert.strictEqual(rich.coins, rb2 + 30);
  assert.strictEqual(mid.coins, mb2 + 30);
  assert.strictEqual(db.challenges[ab].status, 'cancelled');
  ok('an unstarted staked race older than 24 hours is refunded automatically');

  // ---- started races nobody finishes end after 3 days ----
  const startedRace = async (stake) => { const id = await create(rich, { levels: 20, stake }); await join(mid, id); await start(rich, id); return id; };
  const age = (id, days) => { db.challenges[id].startedAt = Date.now() - days * 24 * 3600 * 1000; dbm.flush(); };
  // 2 days in: nothing happens
  const t1 = await startedRace(40);
  age(t1, 2);
  await call('GET /api/challenges', rich);
  assert.strictEqual(db.challenges[t1].status, 'active', 'a race younger than 3 days keeps running');
  // 3+ days, one player ahead: the leader takes the pot
  db.challenges[t1].players[mid.id].solved = 5; db.challenges[t1].players[rich.id].solved = 2;
  age(t1, 3.1);
  const rc = rich.coins, mc = mid.coins;
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(db.challenges[t1].status, 'finished');
  assert.strictEqual(db.challenges[t1].winner, mid.id);
  assert.strictEqual(mid.coins, mc + 80, 'the leader wins the whole pot');
  assert.strictEqual(rich.coins, rc);
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(mid.coins, mc + 80, 'paid only once');
  // 3+ days, tied on levels and score: everyone refunded
  const t2 = await startedRace(25);
  age(t2, 4);
  const rc2 = rich.coins, mc2 = mid.coins;
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(db.challenges[t2].status, 'cancelled');
  assert.strictEqual(rich.coins, rc2 + 25); assert.strictEqual(mid.coins, mc2 + 25);
  ok('a started race ends after 3 days: most levels wins the pot, a tie refunds everyone');
  // free lobby nobody started: closed after 2 days only
  const fl = await create(rich, { levels: 20 });
  db.challenges[fl].createdAt = Date.now() - 30 * 3600 * 1000; dbm.flush();
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(db.challenges[fl].status, 'waiting', '30 hours is too soon for a free lobby');
  db.challenges[fl].createdAt = Date.now() - 49 * 3600 * 1000; dbm.flush();
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(db.challenges[fl].status, 'cancelled');
  ok('free lobbies nobody starts are closed after 2 days');

  // a race with no stake costs nothing and does not touch coins
  const free = await create(rich, { levels: 20 });
  assert.strictEqual((await state(rich, free)).stake, 0);
  ok('races without a stake never touch coins');

  // ---- someone with 10 open challenges cannot open more ----
  const spammer = user('Spammer');
  for (let i = 0; i < 10; i++) await create(spammer, { maxPlayers: 3 });
  await fails(429, () => create(spammer, { maxPlayers: 3 }));
  ok('open challenge limit applies');

  // ---- older 5-puzzle challenges still work the old way ----
  const old = { id: 'OLD234', createdBy: ada.id, invited: null, category: null, maxPlayers: 2, closed: false,
    puzzleIds: P.puzzles.slice(0, 5).map((p) => p.id), createdAt: 1, status: 'waiting', players: {}, winner: null };
  const oldP = (u) => ({ username: u.username, idx: 0, startedAt: null, wrong: 0, score: 0, results: [], finishedAt: null });
  old.players[ada.id] = oldP(ada);
  db.challenges[old.id] = old;
  await join(efe, old.id);
  await fails(404, () => call('GET /api/watch/:code', chidi, { params: { code: old.id } })); // only races can be watched
  for (const u of [ada, efe]) for (let i = 0; i < 5; i++) {
    const s = await state(u, old.id);
    assert.strictEqual(s.race, false);
    assert.strictEqual(s.rounds, 5);
    await guess(u, old.id, P.fromPublic(s.puzzle.id).answer);
  }
  const oldEnd = await state(ada, old.id);
  assert.strictEqual(oldEnd.status, 'finished');
  assert.ok(['me', 'opponent', 'draw'].includes(oldEnd.winner));
  ok('older 5-puzzle challenges still finish the old way (highest score)');

  // ---- big races: up to 20 players, and the host may share the pot between the top 3 ----
  let racerNo = 0;
  const crowd = (n, coins) => Array.from({ length: n }, () => { const u = user('Racer' + (racerNo++)); u.coins = coins; return u; });
  const host = crowd(1, 1000)[0];
  await fails(400, () => create(host, { levels: 20, maxPlayers: 21 }));
  const free20 = await create(host, { levels: 20, maxPlayers: 20 });
  assert.strictEqual((await state(host, free20)).maxPlayers, 20, 'free races take up to 20 players');
  const bigWinner = await create(host, { levels: 20, maxPlayers: 20, stake: 10 });
  assert.strictEqual((await state(host, bigWinner)).split, null, 'winner takes all is the default');
  const hostBefore = host.coins;
  const crew = crowd(11, 1000);
  const mkSplit = async (stake, solved) => {
    const h = crowd(1, 1000)[0];
    const id = await create(h, { levels: 20, maxPlayers: 12, stake, split: 'top3' });
    assert.strictEqual((await call('GET /api/challenges/:id', h, { params: { id } })).split, 'top3');
    for (const u of crew) await join(u, id);
    assert.strictEqual(countOf(id), 12);
    await start(h, id);
    const all = [h, ...crew];
    solved.forEach((n, i) => { db.challenges[id].players[all[i].id].solved = n; });
    const before = all.map((u) => u.coins);
    db.challenges[id].startedAt = Date.now() - 4 * 24 * 3600 * 1000; dbm.flush();
    require('../src/routes/challenges').sweepStale();
    assert.strictEqual(db.challenges[id].status, 'finished');
    const got = all.map((u, i) => u.coins - before[i]);
    assert.strictEqual(got.reduce((a, b) => a + b, 0), stake * 12, 'every coin of the pot is paid out');
    return { got, id, h, all };
  };
  let r1 = await mkSplit(100, [10, 7, 5, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(r1.got.slice(0, 5), [720, 300, 180, 0, 0], 'top 3 share 60/25/15');
  const view1 = await state(r1.all[1], r1.id);
  assert.strictEqual(view1.place, 2); assert.strictEqual((await state(r1.all[0], r1.id)).winner, 'me', 'the leader of a timed-out race is shown as the winner');
  assert.strictEqual(view1.prize, 300); assert.deepStrictEqual(view1.prizes.map((p) => p.coins), [720, 300, 180]);
  r1 = await mkSplit(100, [10, 7, 7, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(r1.got.slice(0, 4), [720, 240, 240, 0], 'a tie for 2nd shares the 2nd and 3rd place money');
  r1 = await mkSplit(100, [10, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(r1.got.slice(0, 3), [840, 360, 0], 'only two players cleared a level: 70/30');
  r1 = await mkSplit(100, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(r1.got[0], 1200, 'nobody else cleared a level: the winner takes it all');
  r1 = await mkSplit(33, [9, 6, 6, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(r1.got[0] >= 237 && r1.got[0] <= 240, true, 'odd pots: leftover coins go to first place');
  // winner-takes-all in a 12-player staked race (the host did not choose the split)
  const hw = crowd(1, 1000)[0];
  const idw = await create(hw, { levels: 20, maxPlayers: 12, stake: 50 });
  for (const u of crew) await join(u, idw);
  await start(hw, idw);
  db.challenges[idw].players[crew[2].id].solved = 8; db.challenges[idw].players[crew[3].id].solved = 4;
  const cb = crew[2].coins;
  db.challenges[idw].startedAt = Date.now() - 4 * 24 * 3600 * 1000; dbm.flush();
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(crew[2].coins, cb + 600, 'without the split the leader takes the whole pot');
  ok('up to 20 players, also with stakes; the host can share the pot between the top 3 (ties and small pots handled)');

  // ---- finished races are announced in the public chat ----
  { const rows = dbm.chat.since(0, 5000).filter((r) => r.user_id === 'sabi-results');
    assert.ok(rows.length >= 3, 'every finished race posts a result');
    const info = JSON.parse(rows[0].text.slice(1));
    assert.ok(info.w && info.n >= 2 && !('l' in info), 'only the winner is named; the other players are not stored');
    assert.ok(rows.every((r) => r.to_id == null));
    ok('finished races are announced in the public chat'); }

  console.log(`\nAll ${passed} race checks passed.`);
  dbm.flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('\nGROUP TEST FAILED:', e.stack || e.message);
  process.exit(1);
});
