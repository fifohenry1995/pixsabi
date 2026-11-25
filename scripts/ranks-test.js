'use strict';
// Run with: npm test (or: node scripts/ranks-test.js)
// Checks rank titles, badges, per-category points, the weekly leaderboard and its coin prizes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-ranks-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PUZZLES_FILE = path.join(tmp, 'puzzles.json');
fs.copyFileSync(path.join(__dirname, '..', 'content', 'puzzles.json'), process.env.PUZZLES_FILE);
const list = JSON.parse(fs.readFileSync(process.env.PUZZLES_FILE, 'utf8'));
for (let i = 0; i < 5; i++) list.push({ a: 'UNIVERSE' + String.fromCharCode(65 + i), c: 'Universal', t: ['🌍', '🌎', '🌏', '🗺️'], clue: 'c', fact: 'f' });
fs.writeFileSync(process.env.PUZZLES_FILE, JSON.stringify(list));

const { db, newUser, q, inbox, meta } = require('../src/db');
const P = require('../src/puzzles');
const Points = require('../src/points');
const Weekly = require('../src/weekly');
const Titles = require('../src/titles');
const Notify = require('../src/notify');

const handlers = {};
require('../src/routes/leaderboard')({ route: (m, p, h) => { handlers[`${m} ${p}`] = h; } });
const board = (u, b) => handlers['GET /api/leaderboard']({ user: u, params: {}, body: {}, query: b ? { board: b } : {}, headers: {} });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

(async () => {
  // ---- titles ----
  assert.strictEqual(Titles.titleOf(0).name, 'Newcomer');
  assert.strictEqual(Titles.titleOf(299).name, 'Newcomer');
  assert.strictEqual(Titles.titleOf(300).name, 'Learner');
  assert.strictEqual(Titles.titleOf(1000).tier, 3);
  const mid = Titles.titleOf(650);
  assert.strictEqual(mid.next.name, 'Sabi Person'); assert.strictEqual(mid.progress, 50);
  assert.strictEqual(Titles.titleOf(99999).name, 'Naija Legend'); assert.strictEqual(Titles.titleOf(99999).next, null);
  assert.strictEqual(Titles.titleOf(-5).name, 'Newcomer');
  ok('rank titles follow total points, with progress to the next one');

  // ---- adding points keeps every total in step ----
  const ada = user('Ada');
  Points.add(ada, 100, 'Naija'); Points.add(ada, 60, 'Universal'); Points.add(ada, -50, 'Naija'); Points.add(ada, 0, 'Naija'); Points.add(ada, 40, 'Food');
  assert.strictEqual(ada.points, 200);
  assert.deepStrictEqual(ada.pts, { Naija: 140, Universal: 60 });
  assert.strictEqual(ada.week.id, Points.weekIdOf()); assert.strictEqual(ada.week.pts, 200);
  ok('points go to the total, the category and this week; zero and negative amounts add nothing');

  // ---- players from before this update ----
  const old = user('Oldtimer');
  old.points = 500;
  const uniId = P.puzzles.find((p) => p.category === 'Universal').id;
  old.solved = { jollof: 100, [uniId]: 80 };
  Points.ensure(old);
  assert.deepStrictEqual(old.pts, { Naija: 420, Universal: 80 });
  Points.migrate();
  assert.strictEqual(meta.get('points_migrated'), '1');
  ok('existing players get category points worked out from what they solved');

  // ---- the week and its end ----
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(Points.weekIdOf()));
  assert.strictEqual(new Date(Points.weekIdOf() + 'T00:00:00Z').getUTCDay(), 1, 'a week starts on Monday');
  assert.strictEqual(new Date(Points.weekIdOf(new Date('2026-10-28T12:00:00Z'))).toISOString().slice(0, 10), '2026-10-26');
  assert.strictEqual(Points.weekIdOf(new Date('2026-11-01T22:59:00Z')), '2026-10-26', 'Sunday 23:59 Lagos is still the old week');
  assert.strictEqual(Points.weekIdOf(new Date('2026-11-01T23:00:00Z')), '2026-11-02', 'Monday 00:00 Lagos starts the new week');
  assert.strictEqual(Points.weekEndsAt(new Date('2026-10-28T12:00:00Z')), Date.parse('2026-11-01T23:00:00Z'));
  ok('the week runs Monday 00:00 to Sunday 23:59 Lagos time');

  // ---- weekly prizes ----
  const prev = Points.prevWeekIdOf();
  const mk = (name, pts) => { const u = user(name); u.points = pts; Points.ensure(u); u.week = { id: prev, pts }; u.coins = 10; return u; };
  const a = mk('Aa', 400), b = mk('Bb', 300), c = mk('Cc', 150), d = mk('Dd', 90), e = mk('Ee', 120);
  const won = Weekly.settle();
  assert.deepStrictEqual(won.map((w) => [w.username, w.prize]), [['Aa', 200], ['Bb', 100], ['Cc', 50]]);
  assert.strictEqual(a.coins, 210); assert.strictEqual(b.coins, 110); assert.strictEqual(c.coins, 60);
  assert.strictEqual(e.coins, 10, 'fourth place wins nothing'); assert.strictEqual(d.coins, 10, 'under 100 points does not qualify');
  assert.strictEqual(a.weeklyWins, 1); assert.strictEqual(b.weeklyWins, undefined);
  assert.strictEqual(inbox.list('aa', 5)[0].kind, 'weekly');
  assert.strictEqual(Weekly.settle(), null, 'the same week is never paid twice');
  assert.strictEqual(a.coins, 210);
  assert.strictEqual(Weekly.lastWinners().week, prev);
  ok('top 3 of last week (at least 100 points) get 200, 100 and 50 coins, once');

  // ---- a new week cannot start before last week is paid ----
  meta.set('weekly_paid', 'x');
  const f = mk('Ff', 500); f.coins = 0;
  Weekly.start();                       // switches on the pay-before-new-week rule (and pays now)
  assert.strictEqual(f.coins, 200);
  meta.set('weekly_paid', 'x');         // pretend it has not been paid, then somebody earns their first points of the week
  const g = mk('Gg', 450); g.coins = 0;
  Points.add(g, 10, 'Naija');
  assert.strictEqual(g.coins, 100, 'last week is paid before the new week replaces the old numbers');
  assert.strictEqual(g.week.id, Points.weekIdOf()); assert.strictEqual(g.week.pts, 10);
  ok('last week is settled before anybody starts the new week');

  // ---- leaderboards ----
  const o = await board(ada);
  assert.strictEqual(o.board, 'overall'); assert.ok(o.top.length >= 5);
  assert.ok(o.top.every((r, i) => i === 0 || o.top[i - 1].points >= r.points), 'best first');
  assert.ok(o.top.find((r) => r.username === 'Ada').you);
  assert.ok(o.top[0].tier >= 1 && o.top[0].title);
  const wkb = await board(ada, 'weekly');
  assert.strictEqual(wkb.board, 'weekly'); assert.strictEqual(wkb.weekly.prizes.length, 3); assert.strictEqual(wkb.weekly.min, 100);
  assert.ok(wkb.weekly.endsAt > Date.now()); assert.strictEqual(wkb.weekly.last.week, prev);
  assert.ok(wkb.top.every((r) => r.points >= 1)); assert.strictEqual(wkb.me.points, 200); assert.strictEqual(wkb.me.rank, 1 + wkb.top.filter((r) => r.points > 200).length);
  const nb = await board(ada, 'naija');
  assert.strictEqual(nb.me.points, 140);
  const ub = await board(ada, 'universal');
  assert.strictEqual(ub.me.points, 60); assert.strictEqual(ub.top[0].username === 'Ada' || ub.top[0].points >= 60, true);
  assert.ok(ub.top.every((r) => r.points > 0), 'only players with points in that category');
  const nobody = user('Nobody');
  const nb2 = await board(nobody, 'universal');
  assert.strictEqual(nb2.me.rank, null); assert.strictEqual(nb2.me.points, 0);
  assert.strictEqual((await board(ada, 'nonsense')).board, 'overall');
  ok('overall, weekly, Naija and Universal boards each sort their own points');

  // ---- Word Search board, and "X passed you" alerts ----
  const w1 = user('Wsone'), w2 = user('Wstwo'), w3 = user('Wsthree');
  Points.add(w1, 100, 'Word Search'); Points.add(w2, 60, 'Word Search'); Points.add(w3, 30, 'Word Search');
  assert.deepStrictEqual([w1.pts['Word Search'], w1.pts.Naija, w1.points], [100, 0, 100], 'word search points have their own category but still count in the total');
  const wsb = await board(w1, 'wordsearch');
  assert.strictEqual(wsb.board, 'wordsearch'); assert.strictEqual(wsb.top[0].username, 'Wsone'); assert.strictEqual(wsb.me.rank, 1);
  assert.ok(wsb.top.every((r) => r.points > 0));
  assert.strictEqual((await board(ada, 'wordsearch')).me.rank, null, 'players with no word search points are not on the board');
  const unread = (u) => inbox.list(u.id, 30).filter((n) => n.kind === 'rank');
  assert.strictEqual(unread(w1).length, 0, 'the first points of a player pass nobody');
  Points.add(w3, 45, 'Word Search');                 // 75: passes Wstwo (60), not Wsone (100)
  assert.strictEqual(unread(w2).length, 1); assert.ok(/Wsthree passed you in Word Search ranks/.test(unread(w2)[0].title));
  assert.strictEqual(unread(w1).length, 0);
  Notify.reset();
  Points.add(w1, 5, 'Word Search');                  // a player already ahead passes nobody
  assert.strictEqual(unread(w2).length, 1);
  Points.add(w3, 20, 'Word Search');                 // 95: passes nobody new (Wstwo already told today)
  assert.strictEqual(unread(w2).length, 1, 'once a day per board');
  Notify.reset();
  w2.passAlert['wordsearch'] -= 25 * 3600 * 1000;    // a day later...
  Points.add(w2, 100, 'Word Search');                // Wstwo 160 passes Wsone (105) and Wsthree (95)
  assert.strictEqual(unread(w1).length, 1); assert.strictEqual(unread(w3).length, 1);
  assert.ok(/Wstwo passed you/.test(unread(w1)[0].title));
  // the Naija board is not touched by word search points
  assert.strictEqual((await board(w1, 'naija')).me.rank, null);
  ok('Word Search has its own board, and players are alerted (once a day per board) when somebody passes them');

  // ---- word search points that were counted as Naija points before are moved over once ----
  const oldp = user('Oldws');
  oldp.points = 500; oldp.pts = { Naija: 500, Universal: 0 }; oldp.ws = { done: { a: 120, b: 80 }, cur: null };
  meta.set('ws_points_migrated', '0');
  Points.migrate();
  assert.deepStrictEqual([oldp.pts.Naija, oldp.pts['Word Search'], oldp.points], [300, 200, 500]);
  Points.migrate();
  assert.strictEqual(oldp.pts['Word Search'], 200, 'the move happens only once');
  ok('earlier word search points move from the Naija board to the Word Search board once');

  // ---- badges ----
  const bad = (u) => Object.fromEntries(Titles.badgesOf(u).map((x) => [x.id, x.earned]));
  assert.strictEqual(bad(nobody)['first-win'], false);
  nobody.stats.won = 1; nobody.daily.best = 7; nobody.weeklyWins = 1;
  const bb = bad(nobody);
  assert.ok(bb['first-win'] && bb['streak-7'] && bb['weekly-champ']); assert.ok(!bb['wins-10'] && !bb['streak-30']);
  ok('badges are earned from real progress');

  console.log(`\nAll ${passed} rank checks passed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
