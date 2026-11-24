'use strict';
// Numbers for the dashboard: how many players, how active they are, what they play, what they buy,
// and how the adverts (side pictures and pop-ups) perform. Everything here is counts and totals:
// no names, no emails, no IP addresses. Adverts count views and clicks per day, plus how many different
// (anonymous) visitors saw each one; a visitor is a random code the browser makes up for itself.
const crypto = require('crypto');
const { sql, flush: saveNow } = require('./db');
const Ads = require('./ads');
const Pop = require('./popups');
const P = require('./puzzles');
const WS = require('./wordsearch');
const Slide = require('./slide');

sql.exec(`
  CREATE TABLE IF NOT EXISTS day_counters (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS day_active (day TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (day, user_id)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS ad_events (day TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, closes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, ref)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS ad_visitors (day TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, vid TEXT NOT NULL, PRIMARY KEY (day, kind, ref, vid)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS dash_links (token TEXT PRIMARY KEY, kind TEXT NOT NULL, advertiser TEXT, label TEXT,
    created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, last_seen INTEGER) WITHOUT ROWID;
`);

// Days are counted on Nigerian time (UTC+1) so "today" matches the owner's day.
const LAGOS_MS = 3600_000;
const dayOf = (ms = Date.now()) => new Date(ms + LAGOS_MS).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const rangeOf = (days) => { const end = dayOf(); return Array.from({ length: days }, (_, i) => addDays(end, i - days + 1)); };

const st = {
  bump: sql.prepare('INSERT INTO day_counters (day, key, n) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n'),
  active: sql.prepare('INSERT OR IGNORE INTO day_active (day, user_id) VALUES (?, ?)'),
  ev: {
    view: sql.prepare('INSERT INTO ad_events (day, kind, ref, views) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, ref) DO UPDATE SET views = views + 1'),
    click: sql.prepare('INSERT INTO ad_events (day, kind, ref, clicks) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, ref) DO UPDATE SET clicks = clicks + 1'),
    close: sql.prepare('INSERT INTO ad_events (day, kind, ref, closes) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, ref) DO UPDATE SET closes = closes + 1'),
  },
  seen: sql.prepare('INSERT OR IGNORE INTO ad_visitors (day, kind, ref, vid) VALUES (?, ?, ?, ?)'),
  prune: [
    sql.prepare('DELETE FROM ad_visitors WHERE day < ?'),
    sql.prepare('DELETE FROM day_active WHERE day < ?'),
  ],
};

// ---- counting ----
function bump(key, n = 1) { try { st.bump.run(dayOf(), key, n); } catch (e) { console.error('[stats]', e.message); } }

let activeDay = '', activeSeen = new Set();
function active(userId) {
  const d = dayOf();
  if (d !== activeDay) { activeDay = d; activeSeen = new Set(); }
  if (activeSeen.has(userId)) return;
  activeSeen.add(userId);
  try { st.active.run(d, userId); } catch (e) { console.error('[stats]', e.message); }
}

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|headless|preview|monitor|curl|wget|python|go-http/i;
const vidLog = new Map();   // visitor -> { reset, n }: no more than 120 events a minute per visitor
function adEvent(kind, ref, ev, vid, userAgent) {
  if (BOT.test(userAgent || '')) return false;
  if (!/^[a-f0-9]{16,32}$/.test(vid || '')) return false;
  if (!st.ev[ev]) return false;
  const now = Date.now();
  let l = vidLog.get(vid);
  if (!l || l.reset < now) { l = { reset: now + 60_000, n: 0 }; vidLog.set(vid, l); if (vidLog.size > 20000) vidLog.clear(); }
  if (++l.n > 120) return false;
  const d = dayOf();
  st.ev[ev].run(d, kind, ref);
  if (ev === 'view') st.seen.run(d, kind, ref, vid);
  return true;
}
function prune() {
  try { st.prune[0].run(addDays(dayOf(), -120)); st.prune[1].run(addDays(dayOf(), -500)); } catch { /* ignore */ }
}
setInterval(prune, 6 * 3600_000).unref();

// ---- reading ----
const num = (x) => Number(x) || 0;
const cache = new Map();
function cached(key, ms, fn) {
  const c = cache.get(key);
  if (c && c.at > Date.now() - ms) return c.v;
  const v = fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}

function series(days, rows, pick) {          // rows: [{day, ...}] -> one number per day
  const by = new Map(rows.map((r) => [r.day, r]));
  return days.map((d) => ({ day: d, n: by.has(d) ? num(pick(by.get(d))) : 0 }));
}

function audience() {
  return cached('audience', 60_000, () => {
    saveNow();                                              // players are written a moment after they act, so save first
    const today = dayOf();
    const one = (from) => num(sql.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM day_active WHERE day >= ?').get(from).n);
    const players = num(sql.prepare('SELECT COUNT(*) AS n FROM users').get().n);
    return {
      players,
      dau: one(today), wau: one(addDays(today, -6)), mau: one(addDays(today, -29)),
      firstActiveDay: (sql.prepare('SELECT MIN(day) AS d FROM day_active').get() || {}).d || null,
    };
  });
}

// Everything about the players themselves (one pass over the player rows, kept for a minute).
function playerTotals() {
  return cached('playerTotals', 60_000, () => {
    saveNow();
    const out = { premiumActive: 0, withLevel: 0, levels: { Naija: 0, Universal: 0, 'Word Search': 0, 'Slide Puzzle': 0 }, avgLevels: 0, withEmail: 0 };
    const cat = new Map(P.puzzles.map((p) => [p.id, p.category]));
    let sum = 0;
    for (const r of sql.prepare('SELECT data FROM users').iterate()) {
      let u; try { u = JSON.parse(r.data); } catch { continue; }
      let any = 0;
      for (const id of Object.keys(u.solved || {})) { const c = cat.get(id); if (c && out.levels[c] != null) { out.levels[c]++; any++; } }
      const ws = u.ws && u.ws.done ? Object.keys(u.ws.done).length : 0;
      out.levels['Word Search'] += ws; any += ws;
      const sl = u.sl && u.sl.done ? Object.keys(u.sl.done).length : 0;
      out.levels['Slide Puzzle'] += sl; any += sl;
      if (any) out.withLevel++;
      sum += any;
      if (u.email) out.withEmail++;
      if (Number(u.premiumUntil) > Date.now()) out.premiumActive++;
    }
    const n = num(sql.prepare('SELECT COUNT(*) AS n FROM users').get().n);
    out.avgLevels = n ? Math.round((sum / n) * 10) / 10 : 0;
    return out;
  });
}

function retention() {
  return cached('retention', 5 * 60_000, () => {
    const a = audience();
    const res = { d1: { cohort: 0, back: 0 }, d7: { cohort: 0, back: 0 }, since: a.firstActiveDay };
    if (!a.firstActiveDay) return res;
    const today = dayOf();
    const rows = sql.prepare('SELECT day, user_id FROM day_active WHERE day >= ?').all(addDays(a.firstActiveDay, 0));
    const act = new Map();
    for (const r of rows) { if (!act.has(r.day)) act.set(r.day, new Set()); act.get(r.day).add(r.user_id); }
    const from = Date.parse(addDays(today, -60) + 'T00:00:00Z') - LAGOS_MS;
    for (const u of sql.prepare('SELECT id, created_at FROM users WHERE created_at >= ?').iterate(from)) {
      const c = dayOf(u.created_at);
      if (c < a.firstActiveDay) continue;                      // we were not counting yet on their first day
      for (const [k, n] of [['d1', 1], ['d7', 7]]) {
        const d = addDays(c, n);
        if (d > today) continue;
        res[k].cohort++;
        if (act.get(d) && act.get(d).has(u.id)) res[k].back++;
      }
    }
    return res;
  });
}

function adRows(days, list) {
  const first = days[0], last = days[days.length - 1];
  const ev = sql.prepare('SELECT day, kind, ref, views, clicks, closes FROM ad_events WHERE day >= ? AND day <= ?').all(first, last);
  const uq = sql.prepare('SELECT kind, ref, COUNT(DISTINCT vid) AS n FROM ad_visitors WHERE day >= ? AND day <= ? GROUP BY kind, ref').all(first, last);
  return list.map((it) => {
    const mine = ev.filter((e) => e.kind === it.kind && e.ref === it.ref);
    const views = mine.reduce((s, e) => s + e.views, 0), clicks = mine.reduce((s, e) => s + e.clicks, 0), closes = mine.reduce((s, e) => s + e.closes, 0);
    const u = uq.find((x) => x.kind === it.kind && x.ref === it.ref);
    return {
      ...it, views, clicks, closes, uniques: u ? u.n : 0,
      ctr: views ? Math.round((clicks / views) * 10000) / 100 : 0,
      series: days.map((d) => { const e = mine.find((x) => x.day === d); return { day: d, views: e ? e.views : 0, clicks: e ? e.clicks : 0 }; }),
    };
  });
}

// All adverts the dashboard knows about: the side pictures and the pop-ups, with the advertiser's name.
function advertList() {
  const out = [];
  const meta = Ads.readMeta();
  for (const a of Ads.list()) {
    const m = meta[a.slot] || {};
    out.push({ kind: 'ad', ref: String(a.slot), label: `Side advert ${a.slot} (${a.side})`, advertiser: m.advertiser || '', link: a.link || '', alt: a.alt || '', image: a.image, media: a.gif ? 'gif' : 'image' });
  }
  for (const i of Pop.read().items) {
    out.push({ kind: 'popup', ref: i.id, label: i.title ? `Pop-up: ${i.title}` : `Pop-up ${i.id.slice(0, 4)}`, advertiser: i.advertiser || '', link: i.link || '', alt: i.title || '', image: Pop.urlOf(i), media: i.kind, active: !!i.active });
  }
  return out;
}

// ---- the owner's and the investors' report ----
function overview(days) {
  days = Math.max(7, Math.min(365, Number(days) || 30));
  return cached('overview:' + days + ':' + dayOf(), 30_000, () => {
    const range = rangeOf(days), first = range[0], last = range[range.length - 1];
    const lagosStart = (d) => Date.parse(d + 'T00:00:00Z') - LAGOS_MS;
    const signupRows = sql.prepare('SELECT created_at FROM users WHERE created_at >= ?').all(lagosStart(first));
    const signupBy = new Map();
    for (const r of signupRows) { const d = dayOf(r.created_at); signupBy.set(d, (signupBy.get(d) || 0) + 1); }
    const activeRows = sql.prepare('SELECT day, COUNT(*) AS n FROM day_active WHERE day >= ? GROUP BY day').all(first);
    const counters = sql.prepare('SELECT day, key, n FROM day_counters WHERE day >= ?').all(first);
    const ctr = (key) => series(range, counters.filter((c) => c.key === key), (r) => r.n);
    const orders = sql.prepare("SELECT paid_at, amount_kobo, user_id, coins, pack FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL").all();
    const mine = orders.filter((o) => dayOf(o.paid_at) >= first);
    const revBy = new Map();
    for (const o of mine) { const d = dayOf(o.paid_at); const e = revBy.get(d) || { kobo: 0, n: 0 }; e.kobo += o.amount_kobo; e.n++; revBy.set(d, e); }
    const aud = audience(), pt = playerTotals(), ret = retention();
    const totalKobo = orders.reduce((s, o) => s + o.amount_kobo, 0);
    const premOrders = orders.filter((o) => o.pack === 'premium');
    const premKobo = premOrders.reduce((s, o) => s + o.amount_kobo, 0);
    const coinOrders = orders.filter((o) => o.pack !== 'premium');
    const coinKobo = totalKobo - premKobo;
    const buyers = new Set(coinOrders.map((o) => o.user_id)).size;   // players who bought coins (Premium buyers are counted separately)
    const adverts = adRows(range, advertList());
    const sum = (arr) => arr.reduce((s, x) => s + x.n, 0);
    const signups = range.map((d) => ({ day: d, n: signupBy.get(d) || 0 }));
    return {
      generatedAt: Date.now(), days, from: first, to: last,
      tracking: { activitySince: aud.firstActiveDay, adsSince: (sql.prepare('SELECT MIN(day) AS d FROM ad_events').get() || {}).d || null },
      audience: {
        players: aud.players, dau: aud.dau, wau: aud.wau, mau: aud.mau,
        stickiness: aud.mau ? Math.round((aud.dau / aud.mau) * 100) : 0,
        newInRange: sum(signups), online: require('./presence').count(),
        activated: pt.withLevel, activatedPct: aud.players ? Math.round((pt.withLevel / aud.players) * 100) : 0,
        avgLevels: pt.avgLevels, withEmail: pt.withEmail,
      },
      retention: {
        since: ret.since,
        d1: ret.d1.cohort ? { rate: Math.round((ret.d1.back / ret.d1.cohort) * 100), cohort: ret.d1.cohort } : null,
        d7: ret.d7.cohort ? { rate: Math.round((ret.d7.back / ret.d7.cohort) * 100), cohort: ret.d7.cohort } : null,
      },
      series: {
        signups, active: series(range, activeRows, (r) => r.n),
        solveNaija: ctr('solve:Naija'), solveUniversal: ctr('solve:Universal'), solveWordSearch: ctr('solve:Word Search'), solveSlide: ctr('solve:Slide Puzzle'), daily: ctr('daily'),
        raceCreated: ctr('race:created'), raceJoined: ctr('race:joined'), raceFinished: ctr('race:finished'),
        chat: ctr('chat'), dm: ctr('dm'),
        revenue: range.map((d) => ({ day: d, n: Math.round((revBy.get(d) || { kobo: 0 }).kobo / 100), buys: (revBy.get(d) || { n: 0 }).n })),
      },
      games: {
        levelsTotal: pt.levels,
        puzzles: P.categories().map((c) => ({ name: c.name, count: c.count })).concat([{ name: 'Word Search', count: WS.list.length }, { name: 'Slide Puzzle', count: Slide.list.length }]),
        playsInRange: { Naija: sum(ctr('solve:Naija')), Universal: sum(ctr('solve:Universal')), 'Word Search': sum(ctr('solve:Word Search')), 'Slide Puzzle': sum(ctr('solve:Slide Puzzle')), Daily: sum(ctr('daily')) },
        races: { created: sum(ctr('race:created')), joined: sum(ctr('race:joined')), finished: sum(ctr('race:finished')) },
        chat: { room: sum(ctr('chat')), private: sum(ctr('dm')) },
      },
      money: {
        totalNaira: Math.round(totalKobo / 100), purchases: orders.length, buyers,
        premiumNaira: Math.round(premKobo / 100), premiumPurchases: premOrders.length, premiumActive: pt.premiumActive,
        buyersPct: aud.players ? Math.round((buyers / aud.players) * 1000) / 10 : 0,
        avgOrderNaira: coinOrders.length ? Math.round(coinKobo / 100 / coinOrders.length) : 0,
        rangeNaira: Math.round(mine.reduce((s, o) => s + o.amount_kobo, 0) / 100), rangePurchases: mine.length,
      },
      adverts,
      advertisers: [...new Set(adverts.map((a) => a.advertiser).filter(Boolean))],
    };
  });
}

// ---- one advertiser's report: only their adverts, plus the size of the audience ----
function advertiserView(name, days) {
  days = Math.max(7, Math.min(365, Number(days) || 30));
  const range = rangeOf(days);
  const want = String(name || '').trim().toLowerCase();
  const list = advertList().filter((a) => a.advertiser && a.advertiser.toLowerCase() === want);
  const rows = adRows(range, list).map(({ link, ...r }) => ({ ...r, hasLink: !!link }));
  const aud = audience();
  const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
  return {
    generatedAt: Date.now(), days, from: range[0], to: range[range.length - 1],
    advertiser: list.length ? list[0].advertiser : name,
    audience: { players: aud.players, dau: aud.dau, wau: aud.wau, mau: aud.mau },
    totals: { views: tot('views'), clicks: tot('clicks'), closes: tot('closes'), ctr: tot('views') ? Math.round((tot('clicks') / tot('views')) * 10000) / 100 : 0 },
    adverts: rows,
    since: (sql.prepare('SELECT MIN(day) AS d FROM ad_events').get() || {}).d || null,
  };
}

// ---- share links ----
const newToken = () => crypto.randomBytes(18).toString('base64url');
const links = {
  list: () => sql.prepare('SELECT token, kind, advertiser, label, created_at, revoked, last_seen FROM dash_links ORDER BY created_at DESC').all(),
  create(kind, advertiser, label) {
    const token = newToken();
    sql.prepare('INSERT INTO dash_links (token, kind, advertiser, label, created_at) VALUES (?, ?, ?, ?, ?)').run(token, kind, advertiser || null, label || null, Date.now());
    return token;
  },
  get: (token) => sql.prepare('SELECT * FROM dash_links WHERE token = ?').get(token),
  revoke: (token) => sql.prepare('UPDATE dash_links SET revoked = 1 WHERE token = ?').run(token).changes > 0,
  remove: (token) => sql.prepare('DELETE FROM dash_links WHERE token = ?').run(token).changes > 0,
  seen: (token) => sql.prepare('UPDATE dash_links SET last_seen = ? WHERE token = ?').run(Date.now(), token),
};

module.exports = { dayOf, addDays, bump, active, adEvent, overview, advertiserView, links, advertList };
