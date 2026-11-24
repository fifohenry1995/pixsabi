'use strict';
// Display pictures are picked from a fixed set drawn in the browser (public/js/avatars.js), so they use no storage.
// Only the short key (like "m2" or "a-cool") is saved on the player.
const KEYS = [
  'm1', 'm2', 'm3', 'm4', 'f1', 'f2', 'f3', 'f4',
  'a-happy', 'a-cool', 'a-laugh', 'a-love', 'a-star', 'a-wink',
];
const valid = (k) => typeof k === 'string' && KEYS.includes(k);
module.exports = { KEYS, valid };
