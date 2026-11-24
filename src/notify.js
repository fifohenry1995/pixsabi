'use strict';
// Alerts for players: "X challenged you", "the race started", "X won the race".
// Every alert goes to the player's in-app inbox (the bell) and, if they switched it on, to their phone or browser as a push.
// Guards against spam: the same sender can alert the same player about the same kind of event once a minute,
// and nobody gets more than 30 alerts an hour. A player can switch all alerts off.
const { db, inbox, pushSubs } = require('./db');
const Push = require('./push');

const KEEP = 30;
const PAIR_GAP_MS = 60_000;
const PER_HOUR = 30;
const pairLast = new Map();  // "from>to>kind" -> ms
const hourLog = new Map();   // to -> [ms]

function allowed(from, to, kind) {
  const now = Date.now();
  const k = `${from}>${to}>${kind}`;
  if (now - (pairLast.get(k) || 0) < PAIR_GAP_MS) return false;
  const times = (hourLog.get(to) || []).filter((t) => now - t < 3600_000);
  if (times.length >= PER_HOUR) return false;
  pairLast.set(k, now); times.push(now); hourLog.set(to, times);
  if (pairLast.size > 5000) for (const [key, t] of pairLast) if (now - t > PAIR_GAP_MS) pairLast.delete(key);
  return true;
}

// n: { kind, title, body, url, from }
function notify(toId, n) {
  try {
    const u = db.users[toId];
    if (!u || u.alertsOff || toId === n.from) return false;
    if (!allowed(n.from || '', toId, n.kind)) return false;
    const title = String(n.title).slice(0, 80), body = String(n.body).slice(0, 140), url = String(n.url).slice(0, 100);
    inbox.add(toId, { kind: n.kind, title, body, url });
    inbox.prune(toId, KEEP);
    const subs = pushSubs.of(toId);
    for (const s of subs) {
      Push.send(s, { title, body, url, tag: n.kind + ':' + url }).then((r) => { if (r === 'gone') pushSubs.remove(s.endpoint); }).catch(() => {});
    }
    return true;
  } catch (e) { console.error('[notify]', e.message); return false; }
}
// The admin's announcement goes to everybody (skips the per-sender spam limits). Done in small batches so the game stays responsive.
function broadcast(n) {
  const { q } = require('./db');
  const ids = q.allUserIds();
  let i = 0, sent = 0;
  return new Promise((resolve) => {
    const step = () => {
      for (const end = Math.min(i + 100, ids.length); i < end; i++) {
        try {
          const u = db.users[ids[i]];
          if (!u || u.alertsOff || ids[i] === n.from) continue;
          const title = String(n.title).slice(0, 80), body = String(n.body).slice(0, 140), url = String(n.url).slice(0, 100);
          inbox.add(u.id, { kind: n.kind, title, body, url });
          inbox.prune(u.id, KEEP);
          for (const s of pushSubs.of(u.id)) {
            Push.send(s, { title, body, url, tag: n.kind + ':' + url }).then((r) => { if (r === 'gone') pushSubs.remove(s.endpoint); }).catch(() => {});
          }
          sent++;
        } catch (e) { console.error('[broadcast]', e.message); }
      }
      if (i < ids.length) setImmediate(step); else resolve(sent);
    };
    step();
  });
}
const reset = () => { pairLast.clear(); hourLog.clear(); };

module.exports = { notify, broadcast, reset };
