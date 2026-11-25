'use strict';
// Run with: npm test (or: node scripts/quiz-test.js)
// Checks the Quiz section: locked by default, who can host, question checks, shuffled answers, server-side timing,
// scoring, leaderboard, closing, results, and that quiz scores never touch global points.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-quiz-'));
process.env.ADMIN_USER = 'boss';
const { db, newUser, sql } = require('../src/db');
const Quiz = require('../src/quiz');

const handlers = {};
require('../src/routes/quiz')({ route: (method, pattern, handler) => { handlers[`${method} ${pattern}`] = handler; } });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { params = {}, body = {} } = {}) => handlers[key]({ user: u, params, body, query: {}, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const QS = [
  { q: 'Capital of Nigeria?', options: ['Lagos', 'Abuja', 'Kano', 'Ibadan'], answer: 1, explain: 'Abuja since 1991.' },
  { q: 'Who wrote Things Fall Apart?', options: ['Achebe', 'Soyinka', 'Adichie'], answer: 0 },
  { q: 'Jollof is made with?', options: ['Rice', 'Yam'], answer: 0 },
];

(async () => {
  const boss = user('Boss'), pastor = user('Pastor'), ada = user('Ada'), bola = user('Bola');

  // locked by default
  assert.strictEqual(Quiz.isOpen(), false);
  await fails(404, () => call('GET /api/quiz', ada));
  await fails(404, () => call('GET /api/admin/quiz', ada));
  ok('locked by default; players and non-admins see nothing');

  // admin can still try it while locked
  const t = await call('POST /api/quiz', boss, { body: { title: 'Admin trial', questions: QS } });
  assert.match(t.code, /^[A-Z2-9]{6}$/);
  ok('admin can try it while it is locked');

  await call('PUT /api/admin/quiz/settings', boss, { body: { open: true } });
  assert.strictEqual(Quiz.isOpen(), true);
  await fails(403, () => call('POST /api/quiz', pastor, { body: { title: 'Bible quiz', questions: QS } }));
  ok('open, but ordinary players cannot host until approved');

  await fails(404, () => call('POST /api/admin/quiz/hosts', boss, { body: { username: 'nobody' } }));
  await call('POST /api/admin/quiz/hosts', boss, { body: { username: 'Pastor' } });
  assert.strictEqual((await call('GET /api/quiz', pastor)).canHost, true);
  ok('admin approves a host by username');

  // validation
  const bad = (over, status = 400) => fails(status, () => call('POST /api/quiz', pastor, { body: { title: 'Bible quiz', questions: QS, ...over } }));
  await bad({ title: 'x' });
  await bad({ secs: 3 });
  await bad({ secs: 500 });
  await bad({ closesAt: Date.now() - 1000 });
  await bad({ questions: QS.slice(0, 2) });
  await bad({ questions: [...QS.slice(0, 2), { q: 'x', options: ['a', 'a'], answer: 0 }] });
  await bad({ questions: [...QS.slice(0, 2), { q: 'x', options: ['a', 'b'], answer: 5 }] });
  await bad({ questions: [...QS.slice(0, 2), { q: '', options: ['a', 'b'], answer: 0 }] });
  await bad({ questions: [...QS.slice(0, 2), { q: 'x', options: ['a'], answer: 0 }] });
  ok('titles, times, closing time and every question are checked');

  const { code } = await call('POST /api/quiz', pastor, { body: { title: 'Bible quiz', topic: 'Church', secs: 10, questions: QS } });
  const P = { code };
  const info = await call('GET /api/quiz/:code', ada, { params: P });
  assert.strictEqual(info.count, 3);
  assert.strictEqual(info.questions, undefined, 'players must not get the questions');
  assert.strictEqual(info.isHost, false);
  const hostInfo = await call('GET /api/quiz/:code', pastor, { params: P });
  assert.strictEqual(hostInfo.questions.length, 3);
  assert.strictEqual(hostInfo.editable, true);
  ok('players see no answers; the host sees everything');

  // not on public list until admin lists it
  assert.strictEqual((await call('GET /api/quiz', bola)).listed.length, 0);
  await fails(404, () => call('POST /api/admin/quiz/:code/listed', pastor, { params: P, body: { listed: true } }));
  await call('POST /api/admin/quiz/:code/listed', boss, { params: P, body: { listed: true } });
  assert.strictEqual((await call('GET /api/quiz', bola)).listed.length, 1);
  ok('only the admin can put a quiz on the public list');

  // play: correct answers never sent, options shuffled consistently
  const play = (u) => call('GET /api/quiz/:code/play', u, { params: P });
  const answer = (u, q, idx) => call('POST /api/quiz/:code/answer', u, { params: P, body: { q, idx } });
  const q0 = await play(ada);
  assert.strictEqual(q0.idx, 0);
  assert.strictEqual(q0.options.length, 4);
  assert.deepStrictEqual([...q0.options].sort(), [...QS[0].options].sort());
  assert.strictEqual(JSON.stringify(q0).includes('answer'), false);
  assert.deepStrictEqual((await play(ada)).options, q0.options);
  ok('questions come one at a time, shuffled the same way on reload, with no answer inside');

  // answer correctly
  const rightIdx = q0.options.indexOf('Abuja');
  const r0 = await answer(ada, 0, rightIdx);
  assert.strictEqual(r0.ok, true);
  assert.ok(r0.points >= 100 && r0.points <= 150, `points ${r0.points}`);
  assert.strictEqual(r0.correctIndex, rightIdx);
  assert.strictEqual(r0.explain, 'Abuja since 1991.');
  await fails(409, () => answer(ada, 0, rightIdx));
  await fails(409, () => answer(ada, 2, 0));
  ok('right answer scores 100-150 and cannot be repeated or skipped ahead');

  // timeout cannot be claimed early
  const q1 = await play(ada);
  assert.strictEqual(q1.idx, 1);
  await fails(400, () => answer(ada, 1, -1));
  await fails(400, () => answer(ada, 1, 9));
  const wrong = q1.options.indexOf('Soyinka');
  const r1 = await answer(ada, 1, wrong);
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.points, 0);
  ok('time-out cannot be claimed early; wrong answer scores nothing and shows the right one');

  // late answers count as wrong
  const q2 = await play(ada);
  sql.prepare('UPDATE quiz_plays SET served_at = served_at - 60000 WHERE code = ? AND user_id = ?').run(code, ada.id);
  const r2 = await answer(ada, 2, q2.options.indexOf('Rice'));
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.done, true);
  assert.strictEqual(r2.rank, 1);
  assert.strictEqual((await play(ada)).finished, true);
  ok('an answer after the time has run out counts as wrong; finishing gives a rank');

  // a second player, perfect, beats the first
  const rightAll = async (u, ans) => { for (let i = 0; i < 3; i++) { const q = await play(u); await answer(u, i, q.options.indexOf(ans[i])); } };
  await rightAll(bola, ['Abuja', 'Achebe', 'Rice']);
  const lb = (await call('GET /api/quiz/:code', ada, { params: P })).leaderboard;
  assert.deepStrictEqual(lb.map((x) => x.name), ['Bola', 'Ada']);
  assert.strictEqual(lb[0].correct, 3);
  assert.strictEqual(lb[0].rank, 1);
  ok('leaderboard ranks by score');

  // quiz never changes global points
  assert.ok(!ada.points || Object.values(ada.points).every((v) => !v));
  ok('quiz scores do not touch global points');

  // editing is locked once players start
  await fails(409, () => call('PUT /api/quiz/:code', pastor, { params: P, body: { title: 'Bible quiz', questions: QS.slice().reverse() } }));
  await call('PUT /api/quiz/:code', pastor, { params: P, body: { title: 'Bible quiz 2', questions: QS } });
  assert.strictEqual((await call('GET /api/quiz/:code', pastor, { params: P })).title, 'Bible quiz 2');
  await fails(403, () => call('PUT /api/quiz/:code', ada, { params: P, body: { title: 'Hacked', questions: QS } }));
  ok('questions freeze after the first player; only the host can edit');

  // close / reopen
  await fails(403, () => call('POST /api/quiz/:code/status', ada, { params: P, body: { status: 'closed' } }));
  await call('POST /api/quiz/:code/status', pastor, { params: P, body: { status: 'closed' } });
  const late = user('Late');
  await fails(403, () => play(late));
  assert.strictEqual((await call('GET /api/quiz', late)).listed.length, 0);
  await call('POST /api/quiz/:code/status', pastor, { params: P, body: { status: 'open' } });
  assert.ok((await play(late)).idx === 0);
  ok('closing stops new plays and hides it from the list; reopening works');

  // results (host only)
  await fails(403, () => call('GET /api/quiz/:code/results', ada, { params: P }));
  const res = await call('GET /api/quiz/:code/results', pastor, { params: P });
  assert.strictEqual(res.players.length, 3);
  assert.strictEqual(res.questions[0].seen, 2);
  assert.strictEqual(res.questions[0].right, 2);
  assert.strictEqual(res.players.find((p) => p.name === 'Late').finished, false);
  assert.deepStrictEqual(res.players.find((p) => p.name === 'Bola').marks, [1, 1, 1]);
  assert.deepStrictEqual(res.players.find((p) => p.name === 'Ada').marks, [1, 0, 0]);
  ok('host sees every player and how each question went');

  // admin overview, delete, stay-locked persistence
  const ov = await call('GET /api/admin/quiz', boss);
  assert.strictEqual(ov.total, 2);
  assert.strictEqual(ov.hosts[0].name, 'Pastor');
  await fails(403, () => call('DELETE /api/quiz/:code', ada, { params: P }));
  await call('DELETE /api/quiz/:code', boss, { params: P });
  await fails(404, () => call('GET /api/quiz/:code', ada, { params: P }));
  assert.strictEqual(sql.prepare('SELECT COUNT(*) n FROM quiz_plays WHERE code = ?').get(code).n, 0);
  ok('admin overview works; delete removes the quiz and its plays');

  await call('PUT /api/admin/quiz/settings', boss, { body: { open: false } });
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'quiz.json'), 'utf8'));
  assert.strictEqual(saved.open, false);
  assert.deepStrictEqual(saved.hosts, ['pastor']);
  ok('settings are saved to disk');

  console.log(`\n${passed} quiz checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
