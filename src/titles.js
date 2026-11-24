'use strict';
// Rank titles (from total points), profile badges (from what a player has done) and the tier that colours the photo frame.
// Change the numbers here any time. As you add more puzzles you can add higher titles at the bottom.
const P = require('./puzzles');

const TITLES = [
  { min: 0, name: 'Newcomer', icon: '🌱' },
  { min: 300, name: 'Learner', icon: '📘' },
  { min: 1000, name: 'Sabi Person', icon: '🧠' },
  { min: 2500, name: 'Gist Master', icon: '🎤' },
  { min: 5000, name: 'Oga Sabi', icon: '🎩' },
  { min: 8000, name: 'Area Champion', icon: '🏅' },
  { min: 12000, name: 'Naija Legend', icon: '👑' },
];

function titleOf(points) {
  const pts = Math.max(0, points | 0);
  let i = 0;
  while (i + 1 < TITLES.length && pts >= TITLES[i + 1].min) i++;
  const cur = TITLES[i], next = TITLES[i + 1] || null;
  return {
    name: cur.name, icon: cur.icon, tier: i + 1,
    next: next ? { name: next.name, icon: next.icon, min: next.min } : null,
    progress: next ? Math.round(((pts - cur.min) / (next.min - cur.min)) * 100) : 100,
  };
}
// the short form used next to names and photos
const tagOf = (points) => { const t = titleOf(points); return { title: t.name, icon: t.icon, tier: t.tier }; };

const solvedIn = (u, cat) => Object.keys(u.solved || {}).filter((id) => { const p = P.byId.get(id); return p && p.category === cat; }).length;

const BADGES = [
  { id: 'first-win', icon: '🏁', name: 'First race win', desc: 'Win a race', test: (u) => (u.stats.won || 0) >= 1 },
  { id: 'wins-10', icon: '⚔️', name: '10 race wins', desc: 'Win 10 races', test: (u) => (u.stats.won || 0) >= 10 },
  { id: 'streak-7', icon: '🔥', name: '7-day streak', desc: 'Solve the daily puzzle 7 days in a row', test: (u) => (u.daily.best || 0) >= 7 },
  { id: 'streak-30', icon: '🌋', name: '30-day streak', desc: 'Solve the daily puzzle 30 days in a row', test: (u) => (u.daily.best || 0) >= 30 },
  { id: 'naija-25', icon: '🇳🇬', name: 'Naija 25', desc: 'Solve 25 Naija puzzles', test: (u) => solvedIn(u, 'Naija') >= 25 },
  { id: 'naija-100', icon: '🦅', name: 'Naija 100', desc: 'Solve 100 Naija puzzles', test: (u) => solvedIn(u, 'Naija') >= 100 },
  { id: 'uni-10', icon: '🌍', name: 'Universal 10', desc: 'Solve 10 Universal puzzles', test: (u) => solvedIn(u, 'Universal') >= 10 },
  { id: 'uni-50', icon: '🚀', name: 'Universal 50', desc: 'Solve 50 Universal puzzles', test: (u) => solvedIn(u, 'Universal') >= 50 },
  { id: 'weekly-champ', icon: '🏆', name: 'Weekly champion', desc: 'Finish first on the weekly leaderboard', test: (u) => (u.weeklyWins || 0) >= 1 },
];
const badgesOf = (u) => BADGES.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: !!b.test(u) }));

module.exports = { TITLES, titleOf, tagOf, badgesOf };
