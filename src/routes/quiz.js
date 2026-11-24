'use strict';
// Quiz rooms. A host writes questions, shares a code, and players race through them.
//  * GET    /api/quiz                     hub: listed quizzes, mine (hosted), played, can I host
//  * POST   /api/quiz                     host: { title, topic, secs, closesAt, questions:[{q, options, answer, explain}] }
//  * GET    /api/quiz/:code               info + leaderboard + my state (host also gets the questions)
//  * PUT    /api/quiz/:code               host: change it (questions and timing only while nobody has played)
//  * POST   /api/quiz/:code/status        host: { status: 'open' | 'closed' }
//  * DELETE /api/quiz/:code               host or admin
//  * GET    /api/quiz/:code/play          the current question for me (starts my run the first time)
//  * POST   /api/quiz/:code/answer        { q, idx }  idx -1 means time ran out
//  * GET    /api/quiz/:code/results       host: every player and how each question went
//  * admin: GET /api/admin/quiz, PUT /api/admin/quiz/settings, POST /api/admin/quiz/hosts, POST /api/admin/quiz/:code/listed
// The whole section is locked until the owner opens it on the Admin page (the admin can still try it).
// Quiz scores never touch the global points, ranks or coins.
const { db, sql, avatarUrl } = require('../db');
const { HttpError } = require('../util');
const Quiz = require('../quiz');
const L = Quiz.LIMITS;

const isAdmin = (u) => require('../routes/admin').isAdmin(u);
const nameOf = (id) => (db.users[id] ? db.users[id].username : 'Player');
const DAY = 86400000;

function guard(ctx) {
  if (!Quiz.isOpen() && !isAdmin(ctx.user)) throw new HttpError(404, 'Not found.');
}
function needAdmin(ctx) { if (!isAdmin(ctx.user)) throw new HttpError(404, 'Not found.'); }

function load(ctx, mustHost) {
  guard(ctx);
  const row = Quiz.rowOf(ctx.params.code);
  if (!row) throw new HttpError(404, 'No quiz has that code.');
  const host = row.host_id === ctx.user.id || isAdmin(ctx.user);
  if (mustHost && !host) throw new HttpError(403, 'Only the host can do that.');
  return { row, host };
}
const isClosed = (row, now = Date.now()) => row.status !== 'open' || (row.closes_at > 0 && now > row.closes_at);
const countOf = (code) => sql.prepare('SELECT COUNT(*) n, SUM(finished_at IS NOT NULL) f FROM quiz_plays WHERE code = ?').get(code);

function board(code, limit = 50) {
  return sql.prepare('SELECT user_id, score, correct, total_ms FROM quiz_plays WHERE code = ? AND finished_at IS NOT NULL ORDER BY score DESC, total_ms ASC, started_at ASC LIMIT ?').all(code, limit)
    .map((r, i) => ({ rank: i + 1, id: r.user_id, name: nameOf(r.user_id), avatar: db.users[r.user_id] ? avatarUrl(db.users[r.user_id]) : null, score: r.score, correct: r.correct, ms: r.total_ms }));
}
function myRank(code, uid) {
  const me = sql.prepare('SELECT score, total_ms, started_at FROM quiz_plays WHERE code = ? AND user_id = ? AND finished_at IS NOT NULL').get(code, uid);
  if (!me) return 0;
  const ahead = sql.prepare('SELECT COUNT(*) n FROM quiz_plays WHERE code = ? AND finished_at IS NOT NULL AND (score > ? OR (score = ? AND total_ms < ?) OR (score = ? AND total_ms = ? AND started_at < ?))')
    .get(code, me.score, me.score, me.total_ms, me.score, me.total_ms, me.started_at).n;
  return ahead + 1;
}
function summary(row, ctx) {
  const c = countOf(row.code);
  const qs = Quiz.parseQ(row);
  const closed = isClosed(row);
  const p = sql.prepare('SELECT * FROM quiz_plays WHERE code = ? AND user_id = ?').get(row.code, ctx.user.id);
  return {
    code: row.code, title: row.title, topic: row.topic, host: nameOf(row.host_id), count: qs.length, secs: row.secs,
    status: closed ? 'closed' : 'open', manuallyClosed: row.status !== 'open', closesAt: row.closes_at || 0, listed: !!row.listed, createdAt: row.created_at,
    players: c.n || 0, finished: c.f || 0,
    mine: p ? { started: true, finished: !!p.finished_at, answered: p.cur, score: p.score, correct: p.correct, ms: p.total_ms, rank: p.finished_at ? myRank(row.code, ctx.user.id) : 0 } : { started: false },
  };
}

// Check the title, timing and closing time that a host sends.
function cleanMeta(b) {
  const title = Quiz.clean(b.title, L.title);
  if (title.length < 3) throw new HttpError(400, 'Give the quiz a title of at least 3 letters.');
  const topic = Quiz.clean(b.topic, L.topic);
  let secs = b.secs === undefined || b.secs === '' ? 20 : Number(b.secs);
  if (!Number.isInteger(secs) || secs < L.minSecs || secs > L.maxSecs) throw new HttpError(400, `Time per question must be ${L.minSecs} to ${L.maxSecs} seconds.`);
  let closesAt = Number(b.closesAt) || 0;
  if (closesAt) {
    const now = Date.now();
    if (closesAt <= now) throw new HttpError(400, 'The closing time must be in the future.');
    if (closesAt > now + 366 * DAY) throw new HttpError(400, 'The closing time can be at most one year away.');
  }
  return { title, topic, secs, closesAt };
}
function needQuestions(raw) {
  const r = Quiz.cleanQuestions(raw);
  if (r.error) throw new HttpError(400, r.error);
  return r.questions;
}

module.exports = ({ route }) => {
  route('GET', '/api/quiz', (ctx) => {
    guard(ctx);
    const now = Date.now(), uid = ctx.user.id;
    const brief = (r) => ({ code: r.code, title: r.title, topic: r.topic, host: nameOf(r.host_id), count: parseQ(r).length, status: isClosed(r, now) ? 'closed' : 'open', closesAt: r.closes_at || 0, players: countOf(r.code).n || 0, listed: !!r.listed });
    const parseQ = Quiz.parseQ;
    const listed = sql.prepare("SELECT * FROM quizzes WHERE listed = 1 AND status = 'open' AND (closes_at = 0 OR closes_at > ?) ORDER BY created_at DESC LIMIT 30").all(now).map(brief);
    const mine = sql.prepare('SELECT * FROM quizzes WHERE host_id = ? ORDER BY created_at DESC LIMIT 50').all(uid).map(brief);
    const played = sql.prepare('SELECT q.*, p.score AS my_score, p.finished_at AS my_fin FROM quiz_plays p JOIN quizzes q ON q.code = p.code WHERE p.user_id = ? ORDER BY p.started_at DESC LIMIT 30').all(uid)
      .map((r) => ({ ...brief(r), myScore: r.my_score, myFinished: !!r.my_fin }));
    return { canHost: Quiz.canHost(ctx.user, isAdmin(ctx.user)), limits: L, listed, mine, played };
  }, { auth: true });

  route('POST', '/api/quiz', (ctx) => {
    guard(ctx);
    const admin = isAdmin(ctx.user);
    if (!Quiz.canHost(ctx.user, admin)) throw new HttpError(403, 'You are not set up to host quizzes yet. Ask the PixSabi team.');
    const b = ctx.body || {};
    const meta = cleanMeta(b);
    const questions = needQuestions(b.questions);
    const now = Date.now();
    if (!admin) {
      if (sql.prepare('SELECT COUNT(*) n FROM quizzes WHERE host_id = ?').get(ctx.user.id).n >= L.maxHosted) throw new HttpError(400, `You can keep up to ${L.maxHosted} quizzes. Delete an old one first.`);
      if (sql.prepare('SELECT COUNT(*) n FROM quizzes WHERE host_id = ? AND created_at > ?').get(ctx.user.id, now - DAY).n >= L.perDay) throw new HttpError(429, `You can make ${L.perDay} quizzes a day. Try again tomorrow.`);
    }
    const code = Quiz.newCode();
    sql.prepare('INSERT INTO quizzes (code, host_id, title, topic, secs, questions, listed, status, closes_at, created_at) VALUES (?,?,?,?,?,?,0,?,?,?)')
      .run(code, ctx.user.id, meta.title, meta.topic, meta.secs, JSON.stringify(questions), 'open', meta.closesAt, now);
    return { code };
  }, { auth: true, maxBody: 200 * 1024 });

  route('GET', '/api/quiz/:code', (ctx) => {
    const { row, host } = load(ctx, false);
    const out = { ...summary(row, ctx), isHost: host, leaderboard: board(row.code) };
    if (host) { out.questions = Quiz.parseQ(row); out.editable = !countOf(row.code).n; out.canList = isAdmin(ctx.user); }
    return out;
  }, { auth: true });

  route('PUT', '/api/quiz/:code', (ctx) => {
    const { row } = load(ctx, true);
    const b = ctx.body || {};
    const meta = cleanMeta({ ...b, secs: b.secs === undefined ? row.secs : b.secs });
    const played = countOf(row.code).n > 0;
    let questions = row.questions;
    if (b.questions !== undefined) {
      const qs = needQuestions(b.questions);
      if (played && JSON.stringify(qs) !== row.questions) throw new HttpError(409, 'Players have started this quiz, so the questions cannot change now. Make a new quiz instead.');
      questions = JSON.stringify(qs);
    }
    if (played && meta.secs !== row.secs) throw new HttpError(409, 'Players have started, so the time per question cannot change now.');
    sql.prepare('UPDATE quizzes SET title = ?, topic = ?, secs = ?, closes_at = ?, questions = ? WHERE code = ?').run(meta.title, meta.topic, meta.secs, meta.closesAt, questions, row.code);
    return { ok: true };
  }, { auth: true, maxBody: 200 * 1024 });

  route('POST', '/api/quiz/:code/status', (ctx) => {
    const { row } = load(ctx, true);
    const status = ctx.body && ctx.body.status === 'closed' ? 'closed' : 'open';
    let closes = row.closes_at;
    if (status === 'open' && closes && closes < Date.now()) closes = 0; // reopening clears an old closing time
    sql.prepare('UPDATE quizzes SET status = ?, closes_at = ? WHERE code = ?').run(status, closes, row.code);
    return { status };
  }, { auth: true });

  route('DELETE', '/api/quiz/:code', (ctx) => {
    const { row } = load(ctx, true);
    sql.prepare('DELETE FROM quiz_plays WHERE code = ?').run(row.code);
    sql.prepare('DELETE FROM quizzes WHERE code = ?').run(row.code);
    return { ok: true };
  }, { auth: true });

  // ---- playing ----
  const view = (row, p, qs, now) => {
    const i = p.cur, item = qs[i];
    const order = Quiz.orderFor(row.code, p.user_id, i, item.options.length);
    const total = row.secs * 1000;
    return { idx: i, total: qs.length, q: item.q, options: order.map((k) => item.options[k]), secs: row.secs, remainingMs: Math.max(0, total - (now - p.served_at)), score: p.score };
  };

  route('GET', '/api/quiz/:code/play', (ctx) => {
    const { row } = load(ctx, false);
    const now = Date.now(), uid = ctx.user.id;
    const qs = Quiz.parseQ(row);
    let p = sql.prepare('SELECT * FROM quiz_plays WHERE code = ? AND user_id = ?').get(row.code, uid);
    if (!p) {
      if (isClosed(row, now)) throw new HttpError(403, 'This quiz is closed.');
      sql.prepare('INSERT INTO quiz_plays (code, user_id, started_at) VALUES (?,?,?)').run(row.code, uid, now);
      p = sql.prepare('SELECT * FROM quiz_plays WHERE code = ? AND user_id = ?').get(row.code, uid);
    }
    if (p.finished_at) return { finished: true, score: p.score, correct: p.correct, total: qs.length, ms: p.total_ms, rank: myRank(row.code, uid) };
    if (isClosed(row, now)) throw new HttpError(403, 'This quiz is closed.');
    if (!p.served_at) { sql.prepare('UPDATE quiz_plays SET served_at = ? WHERE code = ? AND user_id = ?').run(now, row.code, uid); p.served_at = now; }
    return view(row, p, qs, now);
  }, { auth: true });

  route('POST', '/api/quiz/:code/answer', (ctx) => {
    const { row } = load(ctx, false);
    const now = Date.now(), uid = ctx.user.id;
    const qs = Quiz.parseQ(row);
    const p = sql.prepare('SELECT * FROM quiz_plays WHERE code = ? AND user_id = ?').get(row.code, uid);
    if (!p || p.finished_at) throw new HttpError(409, 'There is no question waiting for you.');
    if (!p.served_at) throw new HttpError(409, 'Reload the question first.');
    const b = ctx.body || {};
    if (Number(b.q) !== p.cur) throw new HttpError(409, 'That question is already answered.');
    const item = qs[p.cur];
    const order = Quiz.orderFor(row.code, uid, p.cur, item.options.length);
    const limit = row.secs * 1000;
    const elapsed = now - p.served_at;
    let idx = Number(b.idx);
    if (!Number.isInteger(idx) || idx < -1 || idx >= item.options.length) throw new HttpError(400, 'Pick one of the answers.');
    if (elapsed > limit + Quiz.GRACE_MS) idx = -1;                // too late: counts as no answer
    else if (idx === -1 && elapsed < limit - 3000) throw new HttpError(400, 'Time is not up yet.');
    const picked = idx === -1 ? -1 : order[idx];
    const ok = picked === item.answer;
    const ms = Math.min(elapsed, limit);
    const pts = ok ? Quiz.pointsFor(ms, row.secs) : 0;
    let results; try { results = JSON.parse(p.results); } catch { results = []; }
    results.push({ a: picked, ok, ms });
    const cur = p.cur + 1, done = cur >= qs.length;
    sql.prepare('UPDATE quiz_plays SET cur = ?, served_at = NULL, results = ?, score = score + ?, correct = correct + ?, total_ms = total_ms + ?, finished_at = ? WHERE code = ? AND user_id = ?')
      .run(cur, JSON.stringify(results), pts, ok ? 1 : 0, ms, done ? now : null, row.code, uid);
    const after = sql.prepare('SELECT score, correct, total_ms FROM quiz_plays WHERE code = ? AND user_id = ?').get(row.code, uid);
    return {
      ok, points: pts, correctIndex: order.indexOf(item.answer), explain: item.explain || '', score: after.score, correct: after.correct, done,
      ...(done ? { total: qs.length, ms: after.total_ms, rank: myRank(row.code, uid) } : {}),
    };
  }, { auth: true });

  route('GET', '/api/quiz/:code/results', (ctx) => {
    const { row } = load(ctx, true);
    const qs = Quiz.parseQ(row);
    const rows = sql.prepare('SELECT * FROM quiz_plays WHERE code = ? ORDER BY finished_at IS NULL, score DESC, total_ms ASC').all(row.code);
    const perQ = qs.map(() => ({ right: 0, seen: 0 }));
    const players = rows.map((r, i) => {
      let res = []; try { res = JSON.parse(r.results); } catch { /* ignore */ }
      res.forEach((x, k) => { if (perQ[k]) { perQ[k].seen++; if (x.ok) perQ[k].right++; } });
      return { rank: r.finished_at ? i + 1 : 0, name: nameOf(r.user_id), finished: !!r.finished_at, answered: r.cur, score: r.score, correct: r.correct, ms: r.total_ms, marks: res.map((x) => (x.ok ? 1 : 0)) };
    });
    return { title: row.title, code: row.code, total: qs.length, players, questions: qs.map((x, i) => ({ q: x.q, right: perQ[i].right, seen: perQ[i].seen })) };
  }, { auth: true });

  // ---- owner / admin ----
  route('GET', '/api/admin/quiz', (ctx) => {
    needAdmin(ctx);
    const s = Quiz.settings();
    const recent = sql.prepare('SELECT * FROM quizzes ORDER BY created_at DESC LIMIT 40').all().map((r) => ({
      code: r.code, title: r.title, host: nameOf(r.host_id), count: Quiz.parseQ(r).length, status: isClosed(r) ? 'closed' : 'open', listed: !!r.listed, players: countOf(r.code).n || 0, createdAt: r.created_at,
    }));
    return { open: s.open, everyone: s.everyone, hosts: s.hosts.map((id) => ({ id, name: nameOf(id) })), recent, total: sql.prepare('SELECT COUNT(*) n FROM quizzes').get().n };
  }, { auth: true });

  route('PUT', '/api/admin/quiz/settings', (ctx) => {
    needAdmin(ctx);
    Quiz.setSettings({ open: ctx.body.open, everyone: ctx.body.everyone });
    console.log(`[admin] ${ctx.user.username} quiz settings: ${JSON.stringify(Quiz.settings())}`);
    const s = Quiz.settings();
    return { open: s.open, everyone: s.everyone };
  }, { auth: true });

  route('POST', '/api/admin/quiz/hosts', (ctx) => {
    needAdmin(ctx);
    const u = db.users[String(ctx.body.username || '').trim().toLowerCase()];
    if (!u) throw new HttpError(404, 'No player has that username.');
    Quiz.setHost(u.id, ctx.body.add !== false);
    return { hosts: Quiz.settings().hosts.map((id) => ({ id, name: nameOf(id) })) };
  }, { auth: true });

  route('POST', '/api/admin/quiz/:code/listed', (ctx) => {
    needAdmin(ctx);
    const row = Quiz.rowOf(ctx.params.code);
    if (!row) throw new HttpError(404, 'No quiz has that code.');
    const on = ctx.body.listed === true;
    sql.prepare('UPDATE quizzes SET listed = ? WHERE code = ?').run(on ? 1 : 0, row.code);
    return { listed: on };
  }, { auth: true });
};
