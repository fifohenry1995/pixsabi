'use strict';
// Run with: npm test (or: node scripts/racetimer-test.js)
// Checks the host's race timer: only listed times are allowed, the clock starts at Start, and when it runs out the
// player with the most levels cleared wins (tie = refund), by the background check or the moment anybody looks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-racetimer-'));
const dbm = require('../src/db');
const { db, newUser } = dbm;

const handlers = {};
require('../src/routes/challenges')({ route: (method, pattern, handler) => { handlers[`${method} ${pattern}`] = handler; } });
const R = require('../src/routes/challenges');
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; u.coins = 500; return u; };
const call = async (key, u, { params = {}, body = {}, query = {} } = {}) => handlers[key]({ user: u, params, body, query, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const base = { category: 'Naija', levels: 20, maxPlayers: 4 };

(async () => {
  const host = user('Hosty'), ada = user('Ada'), bola = user('Bola');

  await fails(400, () => call('POST /api/challenges', host, { body: { ...base, timeLimit: 7 } }));
  await fails(400, () => call('POST /api/challenges', host, { body: { ...base, timeLimit: -5 } }));
  ok('only the listed timer lengths are accepted');

  const mk = async (extra = {}) => {
    const { stake, ...rest } = extra;
    const { id } = await call('POST /api/challenges', host, { body: { ...base, timeLimit: 10, ...rest } });
    if (stake) { const ch = db.challenges[id]; host.coins -= stake; ch.stake = stake; ch.pot = stake; ch.players[host.id].staked = stake; }   // an old staked race
    await call('POST /api/challenges/join', ada, { body: { code: id } });
    await call('POST /api/challenges/join', bola, { body: { code: id } });
    return id;
  };

  // lobby shows the timer but no deadline yet
  const id = await mk({ stake: 50 });
  const lobby = await call('GET /api/challenges/:id', ada, { params: { id } });
  assert.strictEqual(lobby.timeLimitMin, 10);
  assert.strictEqual(lobby.endsAt, 0);
  assert.strictEqual((await call('GET /api/challenge-preview/:code', ada, { params: { code: id } })).timeLimitMin, 10);
  ok('the lobby and join preview show the timer; the clock has not started');

  // clock starts at Start
  await call('POST /api/challenges/:id/start', host, { params: { id } });
  const live = await call('GET /api/challenges/:id', ada, { params: { id } });
  assert.ok(Math.abs(live.endsAt - (db.challenges[id].startedAt + 600000)) < 50);
  assert.strictEqual(live.status, 'active');
  R.endTimedRaces();
  assert.strictEqual(db.challenges[id].status, 'active', 'not ended while time is left');
  ok('the deadline is start time plus the timer, and the race goes on until then');

  // time runs out: most levels wins the pot
  const ch = db.challenges[id];
  ch.players[ada.id].solved = 3; ch.players[bola.id].solved = 1;
  const pot = ch.pot;
  assert.ok(pot > 0);
  const adaCoins = ada.coins;
  ch.startedAt -= 11 * 60000; dbm.flush();
  R.endTimedRaces();
  assert.strictEqual(ch.status, 'finished');
  assert.strictEqual(ch.winner, ada.id);
  assert.strictEqual(ch.timedOut, true);
  assert.strictEqual(ada.coins, adaCoins + pot, 'the winner gets the pot');
  const fin = await call('GET /api/challenges/:id', bola, { params: { id } });
  assert.strictEqual(fin.winnerName, 'Ada');
  assert.strictEqual(fin.timedOut, true);
  await fails(409, () => call('POST /api/challenges/:id/guess', bola, { params: { id }, body: { id: 'x', answer: 'a' } }));
  ok('when the timer runs out the player with the most levels wins the pot, and play stops');

  // ending is noticed the moment anybody looks, with no background check
  const id2 = await mk();
  await call('POST /api/challenges/:id/start', host, { params: { id: id2 } });
  const c2 = db.challenges[id2];
  c2.players[bola.id].solved = 2;
  c2.startedAt -= 11 * 60000;
  const seen = await call('GET /api/challenges/:id', ada, { params: { id: id2 } });
  assert.strictEqual(seen.status, 'finished');
  assert.strictEqual(seen.winnerName, 'Bola');
  ok('a player opening the race after time is up sees it already ended');

  // nobody ahead: refund
  const id3 = await mk({ stake: 50 });
  const before = [host, ada, bola].map((u) => u.coins);
  assert.ok(db.challenges[id3].pot > 0);
  await call('POST /api/challenges/:id/start', host, { params: { id: id3 } });
  const c3 = db.challenges[id3];
  c3.players[ada.id].solved = 2; c3.players[bola.id].solved = 2; c3.players[ada.id].score = 20; c3.players[bola.id].score = 20;
  c3.startedAt -= 11 * 60000; dbm.flush();
  R.endTimedRaces();
  assert.strictEqual(c3.status, 'cancelled');
  assert.deepStrictEqual([host, ada, bola].map((u) => u.coins), before.map((c) => c + 50));
  const view = await call('GET /api/challenges/:id', ada, { params: { id: id3 } });
  assert.strictEqual(view.cancelled, true); assert.strictEqual(view.timedOut, true);
  await fails(409, () => call('POST /api/challenges/:id/guess', ada, { params: { id: id3 }, body: { id: 'x', answer: 'a' } }));
  ok('a full tie at time-up refunds everybody');

  // no timer: nothing changes
  const id4 = await mk({ timeLimit: 0 });
  await call('POST /api/challenges/:id/start', host, { params: { id: id4 } });
  db.challenges[id4].startedAt -= 5 * 3600 * 1000;
  R.endTimedRaces();
  assert.strictEqual(db.challenges[id4].status, 'active');
  assert.strictEqual((await call('GET /api/challenges/:id', ada, { params: { id: id4 } })).endsAt, 0);
  ok('a race without a timer is not touched');

  console.log(`\n${passed} race timer checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
