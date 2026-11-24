'use strict';
// Who is online right now. Kept in memory only (nothing to save): every request from a
// logged-in player, plus a small "I am here" ping from the open game, marks them as seen.
// A player counts as online if they were seen in the last 2.5 minutes.
const WINDOW_MS = 150_000;
const seen = new Map(); // player id -> last seen (ms)

function touch(id) { if (id) seen.set(id, Date.now()); }
function count() {
  const cutoff = Date.now() - WINDOW_MS;
  let n = 0;
  for (const [id, t] of seen) {
    if (t >= cutoff) n++;
    else seen.delete(id); // forget old entries so the map never grows without limit
  }
  return n;
}
const isOnline = (id) => (seen.get(id) || 0) >= Date.now() - WINDOW_MS;
function clear() { seen.clear(); }

module.exports = { touch, count, isOnline, clear, WINDOW_MS };
