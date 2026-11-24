'use strict';
// Deleting an account. A player asks (Me page, or the public "delete my account" page), and the account is removed
// 3 days later; they can cancel any time before that. The admin can also delete an account.
// Removed: profile, email, recovery answer, picture, chat messages (public and private), alerts, push alerts,
// quiz results and quizzes they hosted, reset links, activity counts. Their finished races stay in other players'
// history but show "Deleted player". Payment records are kept (the law and accounting need them) without the email.
const fs = require('fs');
const crypto = require('crypto');
const { db, q, sql, save, flush, chat, pushSubs, getSecret, AVATAR_DIR } = require('./db');
const Mailer = require('./mailer');

const DELAY_MS = 3 * 24 * 3600 * 1000;
const sign = (payload) => crypto.createHmac('sha256', getSecret()).update('delete:' + payload).digest('base64url');
function makeToken(u, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: u.id, x: now + DELAY_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(token, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return d && d.x > now ? d.u : null; } catch { return null; }
}

const pending = (u) => !!(u && u.deleteAt > 0);
const dateWords = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

// Starts the 3-day countdown. Returns the time the account will be removed.
function schedule(u, now = Date.now()) {
  if (!pending(u)) u.deleteAt = now + DELAY_MS;
  save();
  if (u.email) {
    Mailer.send({
      to: u.email, subject: 'Your PixSabi account will be deleted',
      text: `Hi ${u.username},\n\nYour PixSabi account is set to be deleted on ${dateWords(u.deleteAt)}. Everything in it (coins, points, levels, messages) will be removed and cannot be brought back.\n\nChanged your mind, or was this not you? Log in and tap "Cancel deletion" before that date. If it was not you, also change your password on the Me page.\n\nPixSabi`,
    }).catch(() => {});
  }
  return u.deleteAt;
}
function cancel(u) { u.deleteAt = 0; save(); }

// A name for a deleted player inside other people's race history ("Deleted player", "Deleted player 2", ...).
function aliasIn(ch) {
  let n = 1, a = 'Deleted player';
  while (ch.players[a] || ch.createdBy === a || ch.invited === a) { n++; a = `Deleted player ${n}`; }
  return a;
}

// Removes the account now. Returns { done: true } or { done: false, reason } when the player is still inside a race that has not ended
// (the hourly check tries again, and every race ends within 3 days).
function removeNow(u) {
  const Challenges = require('./routes/challenges');
  const races = q.challengesFor(u.id, 5000);
  for (const ch of races) {
    if (ch.status === 'active' || (ch.status === 'waiting' && ch.players[u.id])) return { done: false, reason: 'race' };
  }
  const email = u.email || '', name = u.username, id = u.id;
  for (const ch of races) {
    if (ch.status === 'waiting') { Challenges.cancelWaiting(ch); }   // a lobby that only invited this player
    const alias = aliasIn(ch);
    if (ch.players[id]) { ch.players[alias] = { ...ch.players[id], username: 'Deleted player' }; delete ch.players[id]; }
    if (ch.createdBy === id) ch.createdBy = alias;
    if (ch.invited === id) ch.invited = alias;
    if (ch.winner === id) ch.winner = alias;
    if (Array.isArray(ch.podium)) ch.podium = ch.podium.map((x) => (x === id ? alias : x));
    db.challenges[ch.id] = ch;
  }
  chat.removeAllFrom(id);
  chat.scrubName(u.username);   // race results in the public room that name this player
  pushSubs.removeAll(id);
  const run = (text, ...args) => sql.prepare(text).run(...args);
  run('DELETE FROM notifications WHERE user_id = ?', id);
  run('DELETE FROM reset_tokens WHERE user_id = ?', id);
  run('DELETE FROM reset_requests WHERE user_id = ?', id);
  run('DELETE FROM day_active WHERE user_id = ?', id);
  run('DELETE FROM quiz_plays WHERE user_id = ?', id);
  run('DELETE FROM quiz_plays WHERE code IN (SELECT code FROM quizzes WHERE host_id = ?)', id);
  run('DELETE FROM quizzes WHERE host_id = ?', id);
  run("UPDATE orders SET email = NULL, user_id = 'deleted' WHERE user_id = ?", id);   // the payment record stays, without the person
  try { fs.unlinkSync(`${AVATAR_DIR}/${id}.jpg`); } catch { /* none */ }
  const inviter = u.invitedBy && db.users[u.invitedBy];
  if (inviter && Array.isArray(inviter.invited)) inviter.invited = inviter.invited.filter((x) => x.id !== id);
  delete db.users[id];
  flush();
  console.log(`[account] ${name} deleted`);
  if (email) Mailer.send({ to: email, subject: 'Your PixSabi account has been deleted', text: `Hi ${name},\n\nAs you asked, your PixSabi account has been deleted. We kept only the payment records the law requires. You are welcome to create a new account any time.\n\nPixSabi` }).catch(() => {});
  return { done: true };
}

// Hourly: remove every account whose 3 days are up.
function sweep(now = Date.now()) {
  let n = 0;
  for (const u of q.usersWithDeleteRequest()) {
    if (!pending(u) || u.deleteAt > now) continue;
    try { if (removeNow(u).done) n++; } catch (e) { console.error('[account] delete failed for', u.username, e.message); }
  }
  return n;
}
function start() {
  const run = () => { try { sweep(); } catch (e) { console.error('[account]', e.message); } };
  const t = setInterval(run, 60 * 60_000); t.unref && t.unref();
  setTimeout(run, 20_000).unref && 0;
}
module.exports = { DELAY_MS, pending, schedule, cancel, removeNow, sweep, start, makeToken, readToken, dateWords };
