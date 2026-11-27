'use strict';
// SQLite database (Node's built-in `node:sqlite`, so there is still nothing to npm install).
// Needs Node 22.13 or newer.
//
// How it works, in plain words:
//  * Each player and each challenge is one row in the database file (data/pixsabi.db).
//  * The app still talks to `db.users[id]` and `db.challenges[code]` like before, but those
//    now load ONE row on demand (and keep recently used rows in memory).
//  * When a route calls save(), only the rows that actually changed are written (a few
//    milliseconds), instead of rewriting the whole file like the old db.json did.
//  * Things that must look at everybody (leaderboard, rank, search, "my challenges", admin
//    counts) are answered by SQL queries with indexes, listed at the bottom as `q`.
//  * If an old data/db.json exists it is imported once, then renamed so it is never read again.
// Profile photos are small JPEG files in DATA_DIR/avatars (back that folder up too).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  throw new Error(`PixSabi needs Node.js 22.13 or newer (you have ${process.version}). Install the LTS version from nodejs.org and try again.`);
}

require('./restoreApply').apply();   // finishes a 'Restore backup' that the admin started (does nothing otherwise)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const DB_FILE = path.join(DATA_DIR, 'pixsabi.db');
const OLD_DB_FILE = path.join(DATA_DIR, 'naija-sabi.db');   // the file's name before the game was renamed PixSabi
const OLD_JSON = path.join(DATA_DIR, 'db.json');
const CACHE_MAX = Number(process.env.DB_CACHE_ROWS) || 5000; // rows kept in memory per table

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });
// An existing game keeps all its players: the old database file (and its WAL side files) is renamed, not copied or replaced.
if (!fs.existsSync(DB_FILE) && fs.existsSync(OLD_DB_FILE)) {
  for (const ext of ['', '-wal', '-shm']) { if (fs.existsSync(OLD_DB_FILE + ext)) fs.renameSync(OLD_DB_FILE + ext, DB_FILE + ext); }
  console.log('[db] renamed naija-sabi.db to pixsabi.db');
}

const sql = new DatabaseSync(DB_FILE);
sql.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, played INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER, data TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS users_rank ON users (points DESC, wins DESC, username COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY, created_by TEXT, invited TEXT, status TEXT,
    open INTEGER NOT NULL DEFAULT 0, created_at INTEGER, data TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS ch_creator ON challenges (created_by, open);
  CREATE INDEX IF NOT EXISTS ch_invited ON challenges (invited, status);
  CREATE TABLE IF NOT EXISTS challenge_players (
    user_id TEXT NOT NULL, challenge_id TEXT NOT NULL, PRIMARY KEY (user_id, challenge_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS cp_challenge ON challenge_players (challenge_id);
  CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL,
    text TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, title TEXT NOT NULL,
    body TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reset_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL,
    outcome TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    ref TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack TEXT NOT NULL, coins INTEGER NOT NULL,
    amount_kobo INTEGER NOT NULL, email TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, paid_at INTEGER
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    body TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS notif_user ON notifications (user_id, id DESC);
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS push_user ON push_subs (user_id);
`);

// Chat: private messages (to_id = the other player; empty = the group room) and edited messages.
{
  const have = new Set(sql.prepare('PRAGMA table_info(chat)').all().map((c) => c.name));
  if (!have.has('to_id')) sql.exec('ALTER TABLE chat ADD COLUMN to_id TEXT');
  if (!have.has('edited_at')) sql.exec('ALTER TABLE chat ADD COLUMN edited_at INTEGER');
  if (!have.has('pinned')) sql.exec('ALTER TABLE chat ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  sql.exec('CREATE INDEX IF NOT EXISTS chat_dm ON chat (to_id, user_id)');
}

// Points per category and for the current week are also kept in their own columns so leaderboards can sort them quickly.
{
  const have = new Set(sql.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  for (const [col, def] of [['pts_naija', 'INTEGER NOT NULL DEFAULT 0'], ['pts_universal', 'INTEGER NOT NULL DEFAULT 0'], ['pts_ws', 'INTEGER NOT NULL DEFAULT 0'], ['pts_sl', 'INTEGER NOT NULL DEFAULT 0'], ['week_id', 'TEXT'], ['week_pts', 'INTEGER NOT NULL DEFAULT 0'], ['email', 'TEXT']]) {
    if (!have.has(col)) sql.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  }
  sql.exec(`CREATE INDEX IF NOT EXISTS users_pn ON users (pts_naija DESC);
            CREATE INDEX IF NOT EXISTS users_pu ON users (pts_universal DESC);
            CREATE INDEX IF NOT EXISTS users_pw ON users (pts_ws DESC);
            CREATE INDEX IF NOT EXISTS users_psl ON users (pts_sl DESC);
            CREATE INDEX IF NOT EXISTS users_week ON users (week_id, week_pts DESC);
            CREATE INDEX IF NOT EXISTS users_email ON users (email);
            CREATE TABLE IF NOT EXISTS reset_tokens (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS reset_user ON reset_tokens (user_id);`);
}

// ---------- one table, exposed like a plain object ----------
// spec.params(obj, json) -> values for spec.upsert; spec.after(id, obj, entry) runs after a write.
function makeStore(table, spec) {
  const getStmt = sql.prepare(`SELECT data FROM ${table} WHERE id = ?`);
  const hasStmt = sql.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ?`);
  const idsStmt = sql.prepare(`SELECT id FROM ${table} ORDER BY id`);
  const upsert = sql.prepare(spec.upsert);
  const cache = new Map();           // id -> { obj, json (what is in the file), ... }
  let touched = new Set();           // ids used since the last write
  let prev = new Set();              // ids used in the write before (still checked once more)

  function write(id, obj, entry) {
    const json = JSON.stringify(obj);
    if (entry && json === entry.json) return;
    upsert.run(...spec.params(obj, json));
    if (spec.after) spec.after(id, obj, entry);
    if (entry) entry.json = json;
  }
  function writeDirty() {
    for (const set of [touched, prev]) {
      for (const id of set) {
        const e = cache.get(id);
        if (e) write(id, e.obj, e);
      }
    }
  }
  function trim() {
    if (cache.size <= CACHE_MAX) return;
    flush();                          // nothing unsaved may be dropped
    const target = Math.floor(CACHE_MAX * 0.9);
    for (const id of cache.keys()) {
      if (cache.size <= target) break;
      if (!touched.has(id) && !prev.has(id)) cache.delete(id);
    }
  }

  const store = {
    get(id) {
      let e = cache.get(id);
      if (e) { cache.delete(id); cache.set(id, e); }      // keep recently used rows last
      else {
        const row = getStmt.get(id);
        if (!row) return undefined;
        e = { obj: JSON.parse(row.data), json: row.data };
        if (spec.onLoad) spec.onLoad(e);
        cache.set(id, e);
        touched.add(id);
        trim();
        return e.obj;
      }
      touched.add(id);
      return e.obj;
    },
    has(id) { return cache.has(id) || !!hasStmt.get(id); },
    set(id, obj) {
      const old = cache.get(id);
      cache.delete(id);
      cache.set(id, { obj, json: null, sig: old ? old.sig : undefined });
      touched.add(id);
      trim();
    },
    delete(id) {
      cache.delete(id); touched.delete(id); prev.delete(id);
      sql.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (spec.afterDelete) spec.afterDelete(id);
    },
    ids() { flush(); return idsStmt.all().map((r) => r.id); },
    pending: () => touched.size > 0,
    writeDirty,
    rotate() { prev = touched; touched = new Set(); },
    writeRaw: (id, obj) => write(id, obj, null),   // used by the one-time import
  };
  return store;
}

const usersStore = makeStore('users', {
  upsert: `INSERT INTO users (id, username, points, wins, played, created_at, data, pts_naija, pts_universal, week_id, week_pts, email, pts_ws, pts_sl)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET username = excluded.username, points = excluded.points, wins = excluded.wins,
           played = excluded.played, created_at = excluded.created_at, data = excluded.data,
           pts_naija = excluded.pts_naija, pts_universal = excluded.pts_universal, week_id = excluded.week_id, week_pts = excluded.week_pts, email = excluded.email, pts_ws = excluded.pts_ws, pts_sl = excluded.pts_sl`,
  params: (u, json) => [u.id, String(u.username), u.points | 0, ((u.stats && u.stats.won) || 0) | 0,
    ((u.stats && u.stats.played) || 0) | 0, u.createdAt || 0, json,
    (u.pts && u.pts.Naija) | 0, (u.pts && u.pts.Universal) | 0, (u.week && u.week.id) || null, (u.week && u.week.pts) | 0, u.email || null, (u.pts && u.pts['Word Search']) | 0, (u.pts && u.pts['Slide Puzzle']) | 0],
});

const delPlayers = sql.prepare('DELETE FROM challenge_players WHERE challenge_id = ?');
const addPlayer = sql.prepare('INSERT OR IGNORE INTO challenge_players (user_id, challenge_id) VALUES (?, ?)');
const sigOf = (ch) => Object.keys(ch.players || {}).join(',');
const isOpen = (ch) => ch.status !== 'finished' && ch.status !== 'cancelled' && !ch.closed && Object.keys(ch.players || {}).length < (ch.maxPlayers || 2);
const challengesStore = makeStore('challenges', {
  upsert: `INSERT INTO challenges (id, created_by, invited, status, open, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET created_by = excluded.created_by, invited = excluded.invited, status = excluded.status,
           open = excluded.open, created_at = excluded.created_at, data = excluded.data`,
  params: (c, json) => [c.id, c.createdBy || null, c.invited || null, c.status || 'waiting', isOpen(c) ? 1 : 0, c.createdAt || 0, json],
  onLoad: (e) => { e.sig = sigOf(e.obj); },
  after: (id, ch, entry) => {
    const sig = sigOf(ch);
    if (entry && entry.sig === sig) return;
    delPlayers.run(id);
    for (const uid of Object.keys(ch.players || {})) addPlayer.run(uid, id);
    if (entry) entry.sig = sig;
  },
  afterDelete: (id) => delPlayers.run(id),
});

// Makes a store behave like a normal object: db.users.ada, db.users[id] = u, id in db.users, Object.values(...).
const asObject = (store) => new Proxy({}, {
  get: (_, k) => (typeof k === 'string' ? store.get(k) : undefined),
  set: (_, k, v) => { if (typeof k === 'string') store.set(k, v); return true; },
  has: (_, k) => typeof k === 'string' && store.has(k),
  deleteProperty: (_, k) => { if (typeof k === 'string') store.delete(k); return true; },
  ownKeys: () => store.ids(),
  getOwnPropertyDescriptor: (_, k) => {
    const v = typeof k === 'string' ? store.get(k) : undefined;
    return v === undefined ? undefined : { value: v, enumerable: true, configurable: true, writable: true };
  },
});

const db = { users: asObject(usersStore), challenges: asObject(challengesStore) };

// ---------- saving ----------
let timer = null;
let dirty = false; // save() was called and the rows have not been written yet
function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  dirty = false;
  sql.exec('BEGIN');
  try {
    usersStore.writeDirty();
    challengesStore.writeDirty();
    sql.exec('COMMIT');
  } catch (e) {
    try { sql.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw e;
  }
  usersStore.rotate();
  challengesStore.rotate();
}
function save() {
  dirty = true;
  if (!timer) {
    timer = setTimeout(() => { timer = null; try { flush(); } catch (e) { console.error('Could not save to the database:', e.message); } }, 100);
  }
}
const sync = () => { if (dirty || usersStore.pending() || challengesStore.pending()) flush(); };
let closed = false;
function shutdown() {
  if (closed) return;
  closed = true;
  try { flush(); sql.exec('PRAGMA wal_checkpoint(TRUNCATE)'); sql.close(); } catch { /* already closed */ }
}
process.on('exit', shutdown);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { shutdown(); process.exit(0); });

// ---------- one-time import of the old db.json ----------
function importOldJson() {
  if (!fs.existsSync(OLD_JSON)) return;
  let old;
  try {
    old = JSON.parse(fs.readFileSync(OLD_JSON, 'utf8'));
  } catch {
    const backup = `${OLD_JSON}.corrupt-${Date.now()}`;
    fs.renameSync(OLD_JSON, backup);
    console.error(`db.json was unreadable. Moved it to ${backup} and starting with an empty database.`);
    return;
  }
  sql.exec('BEGIN');
  try {
    for (const [id, u] of Object.entries(old.users || {})) {
      u.id = u.id || id;
      u.solved = u.solved || {}; u.progress = u.progress || {}; u.current = u.current || {};
      u.daily = u.daily || { lastDate: null, streak: 0, best: 0 };
      u.stats = u.stats || { played: 0, won: 0, lost: 0, drawn: 0 };
      usersStore.writeRaw(u.id, u);
    }
    for (const [id, c] of Object.entries(old.challenges || {})) {
      c.id = c.id || id;
      challengesStore.writeRaw(c.id, c);
    }
    sql.exec('COMMIT');
  } catch (e) {
    sql.exec('ROLLBACK');
    throw new Error(`Could not import db.json into the database: ${e.message}. Your db.json was not changed.`);
  }
  const moved = `${OLD_JSON}.imported-${Date.now()}`;
  fs.renameSync(OLD_JSON, moved);
  console.log(`Imported ${Object.keys(old.users || {}).length} players and ${Object.keys(old.challenges || {}).length} challenges from db.json (kept as ${path.basename(moved)}).`);
}
importOldJson();

// ---------- questions that need to look at everybody (SQL, with indexes) ----------
const st = {
  count: sql.prepare('SELECT COUNT(*) AS n FROM users'),
  byEmail: sql.prepare('SELECT id FROM users WHERE email = ? LIMIT 1'),
  top: sql.prepare('SELECT id FROM users ORDER BY points DESC, wins DESC, username COLLATE NOCASE LIMIT ?'),
  above1: sql.prepare('SELECT COUNT(*) AS n FROM users WHERE points > ?'),
  above2: sql.prepare('SELECT COUNT(*) AS n FROM users WHERE points = ? AND wins > ?'),
  above3: sql.prepare('SELECT COUNT(*) AS n FROM users WHERE points = ? AND wins = ? AND username < ? COLLATE NOCASE'),
  search: sql.prepare('SELECT id FROM users WHERE id >= ? AND id < ? AND id != ? ORDER BY id LIMIT ?'),
  openBy: sql.prepare('SELECT COUNT(*) AS n FROM challenges WHERE created_by = ? AND open = 1'),
  mine: sql.prepare(`SELECT id, created_at FROM challenge_players p JOIN challenges c ON c.id = p.challenge_id WHERE p.user_id = ?
                     UNION SELECT id, created_at FROM challenges WHERE invited = ? AND status = 'waiting'
                     ORDER BY created_at DESC LIMIT ?`),
  activeRaces: sql.prepare("SELECT id FROM challenges WHERE status = 'active'"),
  stale: sql.prepare("SELECT id FROM challenges WHERE status = 'waiting' AND created_at < ?"),
  over: sql.prepare("SELECT id FROM challenges WHERE status IN ('finished', 'cancelled') AND created_at < ?"),
  usersWith: sql.prepare('SELECT id FROM users WHERE instr(data, ?) > 0'),
  delPending: sql.prepare("SELECT id FROM users WHERE instr(data, '\"deleteAt\":') > 0"),
  chWith: sql.prepare('SELECT id FROM challenges WHERE instr(data, ?) > 0'),
  solved: sql.prepare("SELECT j.key AS k, COUNT(*) AS n FROM users u, json_each(u.data, '$.solved') j GROUP BY j.key"),
};
// Boards: 'naija' / 'universal' sort by points earned in that category; weekly sorts this week's points.
const BOARD_COL = { naija: 'pts_naija', universal: 'pts_universal', wordsearch: 'pts_ws', slide: 'pts_sl' };
const boardSt = {};
for (const [k, col] of Object.entries(BOARD_COL)) {
  boardSt[k] = {
    top: sql.prepare(`SELECT id FROM users WHERE ${col} > 0 ORDER BY ${col} DESC, wins DESC, username COLLATE NOCASE LIMIT ?`),
    above: sql.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${col} > ?`),
    between: sql.prepare(`SELECT id FROM users WHERE ${col} >= ? AND ${col} < ? AND ${col} > 0 AND id != ? ORDER BY ${col} DESC LIMIT ?`),
  };
}
boardSt.weekly = {
  top: sql.prepare('SELECT id FROM users WHERE week_id = ? AND week_pts >= ? AND week_pts > 0 ORDER BY week_pts DESC, wins DESC, username COLLATE NOCASE LIMIT ?'),
  above: sql.prepare('SELECT COUNT(*) AS n FROM users WHERE week_id = ? AND week_pts > ?'),
};
const metaSt = { get: sql.prepare('SELECT v FROM meta WHERE k = ?'), set: sql.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v') };
const meta = {
  get(k) { const r = metaSt.get.get(k); return r ? r.v : null; },
  set(k, v) { metaSt.set.run(k, String(v)); },
};

const escapedText = (s) => JSON.stringify(String(s)).slice(1, -1); // how the text looks inside stored JSON

const q = {
  userCount() { sync(); return st.count.get().n; },
  // The player who registered with this email (lowercase), if any.
  userByEmail(email) { sync(); const r = st.byEmail.get(String(email).toLowerCase()); return r ? usersStore.get(r.id) : undefined; },
  // board: 'naija' | 'universal'. Players with points in that category, best first.
  topIn(board, limit) { sync(); return boardSt[board].top.all(limit).map((r) => usersStore.get(r.id)).filter(Boolean); },
  // Players whose points in this board are at least `from` and below `to`: the players somebody just passed.
  passedBy(board, from, to, exceptId, limit) {
    sync();
    return boardSt[board].between.all(from | 0, to | 0, exceptId, limit).map((r) => usersStore.get(r.id)).filter(Boolean);
  },
  rankIn(board, points) { sync(); return boardSt[board].above.get(points | 0).n + 1; },
  // This week's board (weekId = the Monday of that week), only players with at least `min` points.
  topWeekly(weekId, min, limit) { sync(); return boardSt.weekly.top.all(weekId, min | 0, limit).map((r) => usersStore.get(r.id)).filter(Boolean); },
  rankWeekly(weekId, points) { sync(); return boardSt.weekly.above.get(weekId, points | 0).n + 1; },
  // every player id, used by the one-time points migration
  allUserIds() { sync(); return usersStore.ids(); },
  topPlayers(limit) { sync(); return st.top.all(limit).map((r) => usersStore.get(r.id)).filter(Boolean); },
  rankOf(u) {
    sync();
    const w = (u.stats && u.stats.won) || 0;
    const rank = st.above1.get(u.points | 0).n + st.above2.get(u.points | 0, w | 0).n
      + st.above3.get(u.points | 0, w | 0, String(u.username)).n + 1;
    return { rank, players: st.count.get().n };
  },
  searchUsers(prefix, exceptId, limit) {
    sync();
    return st.search.all(prefix, prefix + '￿', exceptId, limit).map((r) => usersStore.get(r.id)).filter(Boolean);
  },
  // Challenges still waiting to start that were made before `cutoff` (ms since 1970).
  activeRaces() { sync(); return st.activeRaces.all().map((r) => challengesStore.get(r.id)).filter(Boolean); },
  staleWaiting(cutoff) { sync(); return st.stale.all(cutoff).map((r) => challengesStore.get(r.id)).filter(Boolean); },
  // Finished or cancelled challenges created before `cutoff` (the hourly clean-up checks each one's end time).
  finishedBefore(cutoff) { sync(); return st.over.all(cutoff).map((r) => challengesStore.get(r.id)).filter(Boolean); },
  openChallengesBy(uid) { sync(); return st.openBy.get(uid).n; },
  challengesFor(uid, limit) {
    sync();
    return st.mine.all(uid, uid, limit).map((r) => challengesStore.get(r.id)).filter(Boolean);
  },
  // Players / challenges whose stored record mentions this puzzle id (callers double-check the details).
  // players who have ever asked to delete their account (the sweep checks each one's deleteAt)
  usersWithDeleteRequest() { sync(); return st.delPending.all().map((r) => usersStore.get(r.id)).filter(Boolean); },
  usersMentioning(puzzleId) { sync(); return st.usersWith.all(escapedText(puzzleId)).map((r) => usersStore.get(r.id)).filter(Boolean); },
  challengesMentioning(puzzleId) { sync(); return st.chWith.all(escapedText(puzzleId)).map((r) => challengesStore.get(r.id)).filter(Boolean); },
  // Map of puzzleId -> how many players solved it (one pass over the table).
  solvedCounts() { sync(); return new Map(st.solved.all().map((r) => [r.k, r.n])); },
};

// ---------- password reset links (only a fingerprint of each link is stored, never the link itself) ----------
const resetSt = {
  del: sql.prepare('DELETE FROM reset_tokens WHERE user_id = ?'),
  add: sql.prepare('INSERT INTO reset_tokens (hash, user_id, expires) VALUES (?, ?, ?)'),
  get: sql.prepare('SELECT user_id, expires FROM reset_tokens WHERE hash = ?'),
  use: sql.prepare('DELETE FROM reset_tokens WHERE hash = ?'),
  old: sql.prepare('DELETE FROM reset_tokens WHERE expires < ?'),
};
const fingerprint = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
// "I forgot my password" requests, so the admin can help players who get no email (or have none on file).
const rrSt = {
  add: sql.prepare('INSERT INTO reset_requests (user_id, at, outcome) VALUES (?, ?, ?)'),
  list: sql.prepare('SELECT id, user_id, at, outcome, done FROM reset_requests ORDER BY done ASC, id DESC LIMIT 100'),
  open: sql.prepare('SELECT COUNT(*) AS n FROM reset_requests WHERE done = 0'),
  done: sql.prepare('UPDATE reset_requests SET done = 1 WHERE id = ?'),
  doneUser: sql.prepare('UPDATE reset_requests SET done = 1 WHERE user_id = ? AND done = 0'),
  setOutcome: sql.prepare('UPDATE reset_requests SET outcome = ? WHERE id = ?'),
  prune: sql.prepare('DELETE FROM reset_requests WHERE at < ?'),
};
const resetReq = {
  add(userId, outcome) { rrSt.prune.run(Date.now() - 30 * 86400_000); return Number(rrSt.add.run(userId, Date.now(), outcome).lastInsertRowid); },
  setOutcome(id, outcome) { rrSt.setOutcome.run(outcome, id); },
  list() { return rrSt.list.all(); },
  open() { return rrSt.open.get().n; },
  done(id) { return rrSt.done.run(id).changes > 0; },
  doneUser(userId) { rrSt.doneUser.run(userId); },
};
const resets = {
  // A fresh link for this player. Any earlier link stops working.
  create(userId, ttlMs) {
    const raw = crypto.randomBytes(32).toString('base64url');
    resetSt.old.run(Date.now());
    resetSt.del.run(userId);
    resetSt.add.run(fingerprint(raw), userId, Date.now() + ttlMs);
    return raw;
  },
  // The player id if the link is real and not expired; the link is used up either way it is checked successfully.
  consume(raw) {
    const h = fingerprint(raw);
    const row = resetSt.get.get(h);
    if (!row) return null;
    resetSt.use.run(h);
    return row.expires >= Date.now() ? row.user_id : null;
  },
};

// ---------- coin purchases (one row per payment attempt) ----------
const ordersSt = {
  add: sql.prepare('INSERT INTO orders (ref, user_id, pack, coins, amount_kobo, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, \'pending\', ?)'),
  get: sql.prepare('SELECT * FROM orders WHERE ref = ?'),
  paid: sql.prepare('UPDATE orders SET status = \'paid\', paid_at = ? WHERE ref = ? AND status != \'paid\''),
  status: sql.prepare('UPDATE orders SET status = ? WHERE ref = ? AND status = \'pending\''),
  recent: sql.prepare('SELECT ref, pack, coins, amount_kobo, status, created_at, paid_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),
};
const orders = {
  create: (o) => ordersSt.add.run(o.ref, o.userId, o.pack, o.coins, o.amountKobo, o.email || null, Date.now()),
  get: (ref) => ordersSt.get.get(ref),
  // true only for the ONE caller that flips the order to paid, so coins can never be given twice
  markPaid: (ref) => ordersSt.paid.run(Date.now(), ref).changes === 1,
  setStatus: (ref, status) => ordersSt.status.run(status, ref),
  recent: (userId, limit = 10) => ordersSt.recent.all(userId, limit),
  // Money received per month (Nigeria time), split into coin packs and premium: [{ month: '2026-11', pack: 'premium'|'coins', kobo, n }]
  paidByMonth: () => sql.prepare("SELECT strftime('%Y-%m', paid_at / 1000 + 3600, 'unixepoch') AS month, CASE WHEN pack = 'premium' THEN 'premium' ELSE 'coins' END AS pack, SUM(amount_kobo) AS kobo, COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL GROUP BY month, pack").all(),
};

// Secret used to sign login cookies. Set SESSION_SECRET in production.
function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

function newUser(username, passHash) {
  return {
    id: username.toLowerCase(),
    username,
    passHash,
    createdAt: Date.now(),
    points: 0,
    coins: 100,
    bio: '',             // short "about me" text, up to 160 characters
    avatarV: 0,          // old uploaded photos only (uploads were removed to save space); 0 = none
    avatarKey: '',       // picked display picture, like 'm2' or 'a-cool' ('' = the letter circle)
    solved: {},          // puzzleId -> points earned
    progress: {},        // puzzleId -> { letters: {index: char}, clue: bool }
    current: {},         // category -> puzzleId currently being played
    daily: { lastDate: null, streak: 0, best: 0 },
    stats: { played: 0, won: 0, lost: 0, drawn: 0 },
  };
}

// A player's display picture: 'preset:<key>' for a picked one (drawn in the browser), a photo link for an old uploaded one, or null.
const avatarUrl = (u) => (!u ? null : u.avatarKey ? `preset:${u.avatarKey}` : u.avatarV ? `/avatars/${u.id}.jpg?v=${u.avatarV}` : null);

// ---------- chat room (one shared room for everybody) ----------
const CHAT_COLS = 'id, user_id, username, text, created_at, to_id, edited_at, pinned';
const chatSt = {
  add: sql.prepare('INSERT INTO chat (user_id, username, text, created_at, to_id) VALUES (?, ?, ?, ?, ?)'),
  recent: sql.prepare(`SELECT ${CHAT_COLS} FROM chat WHERE to_id IS NULL ORDER BY id DESC LIMIT ?`),
  since: sql.prepare(`SELECT ${CHAT_COLS} FROM chat WHERE to_id IS NULL AND id > ? ORDER BY id ASC LIMIT ?`),
  one: sql.prepare(`SELECT ${CHAT_COLS} FROM chat WHERE id = ?`),
  del: sql.prepare('DELETE FROM chat WHERE id = ?'),
  edit: sql.prepare('UPDATE chat SET text = ?, edited_at = ? WHERE id = ?'),
  delUser: sql.prepare('DELETE FROM chat WHERE user_id = ? OR to_id = ?'),
  prune: sql.prepare('DELETE FROM chat WHERE to_id IS NULL AND pinned = 0 AND id <= (SELECT MAX(id) FROM chat) - ?'),
  pin: sql.prepare('UPDATE chat SET pinned = ? WHERE id = ? AND to_id IS NULL'),
  pinned: sql.prepare(`SELECT ${CHAT_COLS} FROM chat WHERE to_id IS NULL AND pinned = 1 ORDER BY id DESC`),
  pruneDm: sql.prepare('DELETE FROM chat WHERE to_id IS NOT NULL AND created_at < ?'),
  thread: sql.prepare(`SELECT ${CHAT_COLS} FROM chat WHERE to_id IS NOT NULL AND ((user_id = ? AND to_id = ?) OR (user_id = ? AND to_id = ?)) ORDER BY id DESC LIMIT ?`),
  threadSince: sql.prepare(`SELECT ${CHAT_COLS} FROM chat WHERE to_id IS NOT NULL AND id > ? AND ((user_id = ? AND to_id = ?) OR (user_id = ? AND to_id = ?)) ORDER BY id ASC LIMIT ?`),
  mine: sql.prepare(`SELECT ${CHAT_COLS} FROM chat WHERE to_id IS NOT NULL AND (user_id = ? OR to_id = ?) ORDER BY id DESC LIMIT 400`),
};
const chat = {
  // A race result for the public room, posted by the game itself (the marker character cannot be typed by players).
  addResult(info) { return Number(chatSt.add.run('sabi-results', 'PixSabi', '\u0001' + JSON.stringify(info), Date.now(), null).lastInsertRowid); },
  scrubName(name) { return sql.prepare("DELETE FROM chat WHERE user_id = 'sabi-results' AND instr(text, ?) > 0").run(JSON.stringify(String(name))).changes; },
  add(u, text, toId) { return Number(chatSt.add.run(u.id, u.username, text, Date.now(), toId || null).lastInsertRowid); },
  recent(limit) { return chatSt.recent.all(limit).reverse(); },          // oldest first
  since(afterId, limit) { return chatSt.since.all(afterId, limit); },
  get(id) { return chatSt.one.get(id); },
  remove(id) { return chatSt.del.run(id).changes > 0; },
  edit(id, text) { return chatSt.edit.run(text, Date.now(), id).changes > 0; },
  pin(id, on) { return chatSt.pin.run(on ? 1 : 0, id).changes > 0; },
  pinned() { return chatSt.pinned.all(); },        // newest pin first
  removeAllFrom(userId) { return chatSt.delUser.run(userId, userId).changes; },
  prune(keep) { chatSt.prune.run(keep); chatSt.pruneDm.run(Date.now() - 90 * 86400_000); },
  thread(a, b, limit) { return chatSt.thread.all(a, b, b, a, limit).reverse(); },
  threadSince(a, b, afterId, limit) { return chatSt.threadSince.all(afterId, a, b, b, a, limit); },
  mine(id) { return chatSt.mine.all(id, id); },                          // newest first, every private message the player sent or got
};

// ---------- announcements from the admin ----------
const aSt = {
  add: sql.prepare('INSERT INTO announcements (user_id, title, body, created_at) VALUES (?, ?, ?, ?)'),
  list: sql.prepare('SELECT id, user_id, title, body, created_at FROM announcements ORDER BY id DESC LIMIT ?'),
  one: sql.prepare('SELECT id, user_id, title, body, created_at FROM announcements WHERE id = ?'),
  del: sql.prepare('DELETE FROM announcements WHERE id = ?'),
  latest: sql.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM announcements'),
  newer: sql.prepare('SELECT COUNT(*) AS n FROM announcements WHERE id > ?'),
};
const announce = {
  add(userId, title, body) { return Number(aSt.add.run(userId, title, body, Date.now()).lastInsertRowid); },
  list(limit) { return aSt.list.all(limit); },
  get(id) { return aSt.one.get(id); },
  remove(id) { return aSt.del.run(id).changes > 0; },
  latestId() { return aSt.latest.get().n; },
  newerThan(id) { return aSt.newer.get(id | 0).n; },
};

// ---------- alerts: the in-app inbox and the browser push subscriptions ----------
const nSt = {
  add: sql.prepare('INSERT INTO notifications (user_id, kind, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  list: sql.prepare('SELECT id, kind, title, body, url, created_at, read FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'),
  unread: sql.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0'),
  readAll: sql.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0'),
  readOne: sql.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?'),
  prune: sql.prepare('DELETE FROM notifications WHERE user_id = ? AND id NOT IN (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?)'),
};
const inbox = {
  add(userId, n) { return Number(nSt.add.run(userId, n.kind, n.title, n.body, n.url, Date.now()).lastInsertRowid); },
  list(userId, limit) { return nSt.list.all(userId, limit); },
  unread(userId) { return nSt.unread.get(userId).n; },
  readAll(userId) { nSt.readAll.run(userId); },
  readOne(userId, id) { nSt.readOne.run(userId, id); },
  prune(userId, keep) { nSt.prune.run(userId, userId, keep); },
};
const sSt = {
  put: sql.prepare('INSERT OR REPLACE INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)'),
  of: sql.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?'),
  count: sql.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?'),
  del: sql.prepare('DELETE FROM push_subs WHERE endpoint = ?'),
  delMine: sql.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?'),
  delUser: sql.prepare('DELETE FROM push_subs WHERE user_id = ?'),
  oldest: sql.prepare('SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at ASC LIMIT ?'),
};
const pushSubs = {
  put(userId, s) { sSt.put.run(s.endpoint, userId, s.p256dh, s.auth, Date.now()); },
  of(userId) { return sSt.of.all(userId); },
  count(userId) { return sSt.count.get(userId).n; },
  remove(endpoint) { sSt.del.run(endpoint); },
  removeMine(userId, endpoint) { return sSt.delMine.run(endpoint, userId).changes > 0; },
  removeAll(userId) { sSt.delUser.run(userId); },
  trim(userId, keep) { const n = sSt.count.get(userId).n; if (n > keep) for (const r of sSt.oldest.all(userId, n - keep)) sSt.del.run(r.endpoint); },
};

module.exports = { sql, db, q, chat, announce, orders, meta, resets, resetReq, inbox, pushSubs, save, flush, getSecret, newUser, avatarUrl, DATA_DIR, AVATAR_DIR, DB_FILE };
