'use strict';
// Checks the SQLite layer: saving only what changed, surviving a restart, importing an old db.json,
// ranking/search/"my challenges" queries, and a tiny cache that has to evict rows safely.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-dbtest-'));
const root = path.join(__dirname, '..');

// Runs a snippet in a fresh Node process (a "server restart") against the same data folder.
function run(code, env = {}) {
  const r = spawnSync(process.execPath, ['-e', code], {
    cwd: root, encoding: 'utf8', env: { ...process.env, DATA_DIR: tmp, ...env },
  });
  if (r.status !== 0) throw new Error(`child failed:\n${r.stderr || r.stdout}`);
  return r.stdout.trim().split('\n').pop();
}
let n = 0;
const ok = (msg) => console.log(`  ok  ${msg}`) || n++;

// 1) an old db.json is imported once, then set aside
fs.writeFileSync(path.join(tmp, 'db.json'), JSON.stringify({
  users: {
    ada: { id: 'ada', username: 'Ada', passHash: 'x', createdAt: 1, points: 300, coins: 5, solved: { jollof: 100 }, progress: {}, daily: { lastDate: null, streak: 0, best: 0 }, stats: { played: 4, won: 3, lost: 1, drawn: 0 } },
    bayo: { id: 'bayo', username: 'Bayo', passHash: 'x', createdAt: 2, points: 300, coins: 5, solved: {}, progress: {}, daily: { lastDate: null, streak: 0, best: 0 }, stats: { played: 2, won: 1, lost: 1, drawn: 0 } },
  },
  challenges: { ABC234: { id: 'ABC234', createdBy: 'ada', invited: null, maxPlayers: 2, closed: false, puzzleIds: ['jollof'], createdAt: 5, status: 'waiting', players: { ada: { username: 'Ada', idx: 0 } }, winner: null } },
}));
let out = run(`const {db,q}=require('./src/db'); console.log(JSON.stringify([Object.keys(db.users).length, q.userCount(), db.challenges.ABC234.createdBy, q.challengesFor('ada',5).length]))`);
assert.strictEqual(out, '[2,2,"ada",1]');
assert.ok(!fs.existsSync(path.join(tmp, 'db.json')), 'db.json is moved aside');
assert.ok(fs.readdirSync(tmp).some((f) => f.startsWith('db.json.imported-')), 'a copy is kept');
ok('old db.json imported once and kept as a backup copy');

// 2) data survives a restart, and only changed rows are written
out = run(`const {db,save,flush,newUser}=require('./src/db');
  const u=newUser('Chidi','x'); db.users[u.id]=u; u.points=900; u.stats.won=7; save(); flush();
  db.users.ada.points += 50; save(); flush(); console.log('done')`);
out = run(`const {db,q}=require('./src/db'); console.log(JSON.stringify([db.users.chidi.points, db.users.ada.points, 'chidi' in db.users, 'nobody' in db.users, db.users.nobody===undefined]))`);
assert.strictEqual(out, '[900,350,true,false,true]');
ok('new and changed players survive a restart; unknown names are really absent');

// 3) rank order: points, then wins, then name
out = run(`const {db,q}=require('./src/db');
  console.log(JSON.stringify([q.topPlayers(10).map(u=>u.id), q.rankOf(db.users.ada), q.rankOf(db.users.bayo), q.rankOf(db.users.chidi)]))`);
assert.strictEqual(out, '[["chidi","ada","bayo"],{"rank":2,"players":3},{"rank":3,"players":3},{"rank":1,"players":3}]');
ok('leaderboard and rank queries agree');

// 4) search, creator limits, my challenges, constructor-style usernames
out = run(`const {db,q,newUser,save}=require('./src/db');
  for (const name of ['Chika','constructor','Chi_x']) { const u=newUser(name,'x'); db.users[u.id]=u; }
  db.challenges.ZZZ222={id:'ZZZ222',createdBy:'bayo',invited:'ada',maxPlayers:2,closed:false,puzzleIds:['akara','jollof'],createdAt:9,status:'waiting',players:{bayo:{username:'Bayo'}}};
  save();
  console.log(JSON.stringify([q.searchUsers('chi','ada',6).map(u=>u.id), q.openChallengesBy('ada'), q.challengesFor('ada',5).map(c=>c.id),
    q.challengesFor('bayo',5).map(c=>c.id), q.challengesMentioning('jollof').length, !!db.users.constructor.username, q.solvedCounts().get('jollof')]))`);
assert.strictEqual(out, '[["chi_x","chidi","chika"],1,["ZZZ222","ABC234"],["ZZZ222"],2,true,1]');
ok('search, open-challenge count, "my challenges", puzzle lookups and odd usernames');

// 5) joining updates the player index; filling the lobby closes it
out = run(`const {db,q,save}=require('./src/db');
  db.challenges.ABC234.players.bayo={username:'Bayo'}; db.challenges.ABC234.status='active'; save();
  console.log(JSON.stringify([q.challengesFor('bayo',5).map(c=>c.id), q.openChallengesBy('ada')]))`);
assert.strictEqual(out, '[["ZZZ222","ABC234"],0]');
ok('joining a challenge updates "my challenges" and the open count');

// 6) a very small cache must still keep every change (rows are evicted and reloaded)
out = run(`const {db,q,save,flush,newUser}=require('./src/db');
  for (let i=0;i<300;i++){ const u=newUser('P'+i,'x'); db.users[u.id]=u; u.points=i; save(); }
  for (let i=0;i<300;i++){ db.users['p'+i].coins += 1; }
  save(); flush();
  let bad=0; for (let i=0;i<300;i++){ if (db.users['p'+i].points!==i || db.users['p'+i].coins!==101) bad++; }
  console.log(JSON.stringify([bad, q.userCount(), q.topPlayers(1)[0].id]))`, { DB_CACHE_ROWS: '50' });
assert.strictEqual(out, '[0,306,"chidi"]');
out = run(`const {db}=require('./src/db'); console.log(db.users.p299.coins+','+db.users.p0.coins)`);
assert.strictEqual(out, '101,101');
ok('a tiny cache (50 rows) never loses a change');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\nAll ${n} database checks passed.`);
