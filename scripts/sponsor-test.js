'use strict';
// Run with: npm test (or: node scripts/sponsor-test.js)
// Checks sponsored races: only the admin can set one up, it is free, shows on the home list, counts views and taps,
// is joined by ordinary players, reports to the admin, and is not closed by the 48-hour lobby clean-up.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-sponsor-'));
process.env.ADMIN_USER = 'boss';
const dbm = require('../src/db');
const { db, newUser } = dbm;
const P = require('../src/puzzles');

const handlers = {};
const mount = (m) => require(m)({ route: (method, pattern, handler) => { handlers[`${method} ${pattern}`] = handler; } });
mount('../src/routes/challenges');
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { params = {}, body = {}, query = {} } = {}) => handlers[key]({ user: u, params, body, query, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const LOGO = 'data:image/png;base64,' + Buffer.alloc(300, 7).toString('base64');
const SP = { name: 'Mama Put Foods', link: 'https://example.com/shop', prize: 'N5,000 airtime', logo: LOGO };

(async () => {
  const boss = user('Boss'), ada = user('Ada'), bola = user('Bola');
  const body = { category: 'Naija', levels: 20, maxPlayers: 50, sponsor: SP, stake: 500 };

  await fails(403, () => call('POST /api/challenges', ada, { body }));
  await fails(400, () => call('POST /api/challenges', boss, { body: { ...body, sponsor: { ...SP, name: '' } } }));
  await fails(400, () => call('POST /api/challenges', boss, { body: { ...body, sponsor: { ...SP, prize: '' } } }));
  await fails(400, () => call('POST /api/challenges', boss, { body: { ...body, sponsor: { ...SP, link: 'javascript:alert(1)' } } }));
  await fails(400, () => call('POST /api/challenges', boss, { body: { ...body, sponsor: { ...SP, logo: 'data:text/html;base64,AAAA' } } }));
  await fails(400, () => call('POST /api/challenges', boss, { body: { ...body, maxPlayers: 201 } }));
  ok('only the admin can set up a sponsored race, and the sponsor details are checked');

  boss.coins = 1000;
  const { id } = await call('POST /api/challenges', boss, { body });
  const ch = db.challenges[id];
  assert.strictEqual(ch.stake || 0, 0, 'a sponsored race is free even if a stake is sent');
  assert.strictEqual(boss.coins, 1000, 'no coins were taken');
  assert.strictEqual(ch.maxPlayers, 50, 'sponsored races can hold many players');
  ok('it is free, and takes up to 200 players');

  // home list
  assert.deepStrictEqual((await call('GET /api/sponsored', null)).races.length, 1, 'visible without logging in');
  const l1 = (await call('GET /api/sponsored', ada)).races[0];
  assert.strictEqual(l1.id, id); assert.strictEqual(l1.sponsor.name, 'Mama Put Foods'); assert.strictEqual(l1.playerCount, 0); assert.strictEqual(l1.joined, false);
  await call('GET /api/sponsored', ada); await call('GET /api/sponsored', bola);
  await call('POST /api/sponsored/:id/tap', ada, { params: { id } });
  assert.strictEqual(ch.sponsor.views, 2, 'each player is counted once, however often they look');
  assert.strictEqual(ch.sponsor.taps, 1);
  ok('home list works without an account; views are counted once per player; taps are counted');

  // joining
  const pv = await call('GET /api/challenge-preview/:code', ada, { params: { code: id } });
  assert.strictEqual(pv.sponsor.prize, 'N5,000 airtime'); assert.strictEqual(pv.stake, 0);
  await call('POST /api/challenges/join', ada, { body: { code: id } });
  await call('POST /api/challenges/join', bola, { body: { code: id } });
  assert.strictEqual((await call('GET /api/sponsored', ada)).races[0].playerCount, 2, 'the host is not counted as a player');
  assert.strictEqual((await call('GET /api/sponsored', ada)).races[0].joined, true);
  const st = await call('GET /api/challenges/:id', ada, { params: { id } });
  assert.strictEqual(st.sponsor.name, 'Mama Put Foods'); assert.ok(!('seen' in st.sponsor), 'the viewers list stays private');
  assert.ok(!JSON.stringify(st).includes('"views"'), 'the numbers are for the admin only');
  ok('players join for free and the race screen carries the sponsor');

  // not swept
  ch.createdAt = Date.now() - 5 * 24 * 3600 * 1000; dbm.flush();
  require('../src/routes/challenges').sweepStale();
  assert.strictEqual(db.challenges[id].status, 'waiting', 'a sponsored lobby waits for the admin');
  ok('the 48 hour clean-up leaves a sponsored lobby alone');

  // run it
  await call('POST /api/challenges/:id/start', boss, { params: { id } });
  assert.strictEqual((await call('GET /api/sponsored', ada)).races[0].started, true);
  for (let n = 0; n < 20; n++) {
    const s = await call('GET /api/challenges/:id', ada, { params: { id } });
    await call('POST /api/challenges/:id/guess', ada, { params: { id }, body: { guess: P.fromPublic(s.puzzle.id).answer } });
  }
  assert.strictEqual(db.challenges[id].status, 'finished');
  assert.strictEqual((await call('GET /api/sponsored', ada)).races.length, 0, 'a finished race leaves the home list');

  // report
  await fails(404, () => call('GET /api/admin/sponsored', ada));
  const rep = (await call('GET /api/admin/sponsored', boss)).races[0];
  assert.strictEqual(rep.views, 2); assert.strictEqual(rep.taps, 1); assert.strictEqual(rep.joined, 2); assert.strictEqual(rep.finished, 1);
  assert.strictEqual(rep.winner, 'Ada'); assert.strictEqual(rep.status, 'finished'); assert.strictEqual(rep.sponsor.name, 'Mama Put Foods');
  assert.ok(!JSON.stringify(rep).includes('base64'), 'the report does not carry the logo');
  ok('the admin report shows views, taps, joined, finished and the winner');


  // ================= step 2: start time, winner checking, sponsor report link =================
  const makeRace = async (extraSponsor = {}) => (await call('POST /api/challenges', boss, { body: { category: 'Naija', levels: 20, maxPlayers: 50, sponsor: { ...SP, ...extraSponsor } } })).id;
  const play = async (id, u) => {
    for (let n = 0; n < 20; n++) {
      const s = await call('GET /api/challenges/:id', u, { params: { id } });
      await call('POST /api/challenges/:id/guess', u, { params: { id }, body: { guess: P.fromPublic(s.puzzle.id).answer } });
    }
  };
  await fails(400, () => makeRace({ startAt: Date.now() - 3600 * 1000 }));
  await fails(400, () => makeRace({ startAt: Date.now() + 200 * 24 * 3600 * 1000 }));
  const id2 = await makeRace({ startAt: Date.now() + 3600 * 1000 });
  const card2 = (await call('GET /api/sponsored', ada)).races.find((r) => r.id === id2);
  assert.ok(card2.sponsor.startAt > Date.now(), 'the card carries the start time');
  assert.strictEqual(card2.started, false);
  await call('POST /api/challenges/join', ada, { body: { code: id2 } });
  require('../src/routes/challenges').startDueSponsored();
  assert.strictEqual(db.challenges[id2].status, 'waiting', 'it does not start before its time');
  db.challenges[id2].sponsor.startAt = Date.now() - 1000;
  require('../src/routes/challenges').startDueSponsored();
  assert.strictEqual(db.challenges[id2].status, 'active', 'once the time has come and a player is in, it starts');
  ok('a start time can only be in the next 90 days; the race does not start early and starts by itself on time');
  const id3 = await makeRace({ startAt: Date.now() + 3600 * 1000 });
  await call('POST /api/challenges/join', bola, { body: { code: id3 } });
  db.challenges[id3].sponsor.startAt = Date.now() - 1000;
  await call('POST /api/challenges/join', ada, { body: { code: id3 } });   // joining after the time has come starts it by itself
  assert.ok(db.challenges[id3].startedAt, 'it started by itself once the time had come and players were in');
  assert.strictEqual(db.challenges[id3].status, 'active');
  ok('joining after the start time has passed starts the race by itself');

  // ---- winner checking ----
  await play(id3, ada);
  let sp3 = (await call('GET /api/challenges/:id', ada, { params: { id: id3 } })).sponsor;
  assert.strictEqual(sp3.prizeStatus, 'checking'); assert.strictEqual(sp3.prizeYou, true); assert.strictEqual(sp3.prizeToName, 'Ada');
  sp3 = (await call('GET /api/challenges/:id', bola, { params: { id: id3 } })).sponsor;
  assert.strictEqual(sp3.prizeYou, false); assert.strictEqual(sp3.prizeStatus, 'checking', 'others see it is being checked, not paid');
  let rep3 = (await call('GET /api/admin/sponsored', boss)).races.find((r) => r.id === id3);
  assert.strictEqual(rep3.prize.status, 'checking'); assert.strictEqual(rep3.prize.winner.username, 'Ada');
  assert.ok(rep3.prize.winner.flags.length >= 1, 'a brand new, very fast account is flagged');
  assert.ok(rep3.prize.winner.flags.some((f) => /fast/i.test(f)));
  await fails(404, () => call('POST /api/admin/sponsored/:id/prize', ada, { params: { id: id3 }, body: { action: 'approve' } }));
  await fails(400, () => call('POST /api/admin/sponsored/:id/prize', boss, { params: { id: id3 }, body: { action: 'dance' } }));
  await call('POST /api/admin/sponsored/:id/prize', boss, { params: { id: id3 }, body: { action: 'approve' } });
  assert.strictEqual((await call('GET /api/challenges/:id', ada, { params: { id: id3 } })).sponsor.prizeStatus, 'approved');
  await call('POST /api/admin/sponsored/:id/prize', boss, { params: { id: id3 }, body: { action: 'paid' } });
  assert.strictEqual((await call('GET /api/challenges/:id', bola, { params: { id: id3 } })).sponsor.prizeStatus, 'paid');
  await fails(409, () => call('POST /api/admin/sponsored/:id/prize', boss, { params: { id: id3 }, body: { action: 'reject' } }));
  ok('the winner is flagged for checking, then approved, then paid; only the admin can do this and a paid prize cannot be changed');

  // reject: the prize moves on (nobody else finished, so there is no winner)
  const id4 = await makeRace();
  await call('POST /api/challenges/join', ada, { body: { code: id4 } });
  await call('POST /api/challenges/join', bola, { body: { code: id4 } });
  await call('POST /api/challenges/:id/start', boss, { params: { id: id4 } });
  await play(id4, ada);
  await call('POST /api/admin/sponsored/:id/prize', boss, { params: { id: id4 }, body: { action: 'reject' } });
  const sp4 = (await call('GET /api/challenges/:id', ada, { params: { id: id4 } })).sponsor;
  assert.strictEqual(sp4.prizeStatus, 'none'); assert.strictEqual(sp4.prizeYou, false);
  assert.strictEqual(db.challenges[id4].sponsor.rejected.ada, true);
  ok('rejecting a winner passes the prize on, and a rejected player is never chosen again');

  // ---- sponsor report link ----
  const tok = db.challenges[id3].sponsor.reportToken;
  const pub = await call('GET /api/sponsor-report/:token', null, { params: { token: tok } });
  assert.strictEqual(pub.sponsor, 'Mama Put Foods'); assert.strictEqual(pub.joined, 2); assert.strictEqual(pub.finished, 1);
  assert.strictEqual(pub.winner, 'Ada'); assert.strictEqual(pub.prizeStatus, 'paid');
  assert.ok(!JSON.stringify(pub).includes('@'), 'no emails on the sponsor report');
  await fails(404, () => call('GET /api/sponsor-report/:token', null, { params: { token: 'nope' } }));
  const pub4 = await call('GET /api/sponsor-report/:token', null, { params: { token: db.challenges[id4].sponsor.reportToken } });
  assert.strictEqual(pub4.winner, null, 'a rejected winner is not named');
  ok('the sponsor report link needs no login, shows the numbers and never an email');

  console.log(`\nAll ${passed} sponsored race checks passed.`);
  dbm.flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nSPONSOR TEST FAILED:', e.stack || e.message); process.exit(1); });
