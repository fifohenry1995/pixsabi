'use strict';
// One shared puzzle per day (Lagos time). Solve it on consecutive days to build a streak.
const { save } = require('../db');
const { hashStr } = require('../util');
const P = require('../puzzles');
const Points = require('../points');
const Premium = require('../premium');

const DAILY_COINS = 25;

const lagosDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const yesterdayOf = (ymd) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
const dayLabel = (ymd) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${ymd}T12:00:00Z`).getUTCDay()];
// The last 7 Lagos days (today last). A day is "done" if it falls inside the current run of streak days.
function weekOf(u, today, solved) {
  const days = [];
  let d = today;
  for (let i = 0; i < 7; i++) { days.unshift(d); d = yesterdayOf(d); }
  const done = new Set();
  const live = solved || u.daily.lastDate === yesterdayOf(today);
  if (live && u.daily.lastDate) {
    let x = u.daily.lastDate;
    for (let i = 0; i < u.daily.streak; i++) { done.add(x); x = yesterdayOf(x); }
  }
  return days.map((ymd) => ({ label: dayLabel(ymd), done: done.has(ymd), today: ymd === today }));
}
// The seed text is deliberately still 'naija-sabi:' so each day keeps the same puzzle it had before the rename.
const puzzleFor = (ymd) => P.puzzles[hashStr('naija-sabi:' + ymd) % P.puzzles.length];

module.exports = ({ route }) => {
  route('GET', '/api/daily', (ctx) => {
    const u = ctx.user;
    const today = lagosDate();
    const p = puzzleFor(today);
    const solved = u.daily.lastDate === today;
    const streak = solved || u.daily.lastDate === yesterdayOf(today) ? u.daily.streak : 0;
    const out = { date: today, streak, best: u.daily.best, solved, week: weekOf(u, today, solved), puzzle: P.view(p) };
    if (solved) Object.assign(out, Premium.gate(u, { answer: p.answer, fact: p.fact }));
    return out;
  }, { auth: true });

  route('POST', '/api/daily/guess', (ctx) => {
    const u = ctx.user;
    const today = lagosDate();
    const p = puzzleFor(today);
    if (u.daily.lastDate === today) {
      return Premium.gate(u, { correct: true, already: true, answer: p.answer, fact: p.fact, streak: u.daily.streak });
    }
    if (!P.isCorrect(p, ctx.body.guess)) return { correct: false };

    u.daily.streak = u.daily.lastDate === yesterdayOf(today) ? u.daily.streak + 1 : 1;
    u.daily.best = Math.max(u.daily.best, u.daily.streak);
    u.daily.lastDate = today;
    require('../stats').bump('daily');
    const earned = 100 + Math.min(u.daily.streak, 7) * 10;
    Points.add(u, earned, p.category);
    u.coins += DAILY_COINS;
    const inviteBonus = require('./invites').firstSolve(u);
    save();
    return Premium.gate(u, {
      correct: true, answer: p.answer, fact: p.fact, earned,
      streak: u.daily.streak, coins: u.coins, points: u.points, inviteBonus,
    });
  }, { auth: true });
};
