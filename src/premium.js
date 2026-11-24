'use strict';
// Premium members: they pay once for 30 days (no automatic renewal), see no pop-up adverts and get the fun facts.
// u.premiumUntil is the time (ms) their premium ends. Renewing early adds 30 days on top of what is left.
const DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
const fs = require('fs');
const path = require('path');
// The owner can lock Premium from the Admin page until the game has many players. Locked (the default): nobody can buy it,
// fun facts are shown to everybody and the "Go Premium" bar is hidden. People who already have Premium keep it.
const SETTINGS = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'premium.json');
let open = null;
function isOpen() {
  if (open === null) { try { open = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).open === true; } catch { open = false; } }
  return open;
}
function setOpen(v) {
  open = !!v;
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify({ open }));
}
const NAIRA = Math.max(100, Number(process.env.PREMIUM_NAIRA) || 1000);   // price for one period, in naira

const isPremium = (u) => !!u && Number(u.premiumUntil) > Date.now();
const daysLeft = (u) => (isPremium(u) ? Math.max(1, Math.ceil((u.premiumUntil - Date.now()) / DAY_MS)) : 0);

function grant(u, days = DAYS) {
  const base = Math.max(Date.now(), Number(u.premiumUntil) || 0);
  u.premiumUntil = base + days * DAY_MS;
  u.premiumSince = u.premiumSince || Date.now();
  return u.premiumUntil;
}
function remove(u) { u.premiumUntil = 0; }

const info = (u) => ({ premium: isPremium(u), until: isPremium(u) ? u.premiumUntil : null, daysLeft: daysLeft(u) });

// Fun facts are for premium members. Everybody else gets { factLocked: true } so the game can show an invitation instead.
function gate(u, out) {
  if (!out || !('fact' in out)) return out;
  if (!isOpen() || isPremium(u)) return out;
  const had = !!out.fact;
  delete out.fact;
  if (had) out.factLocked = true;
  return out;
}

module.exports = { isOpen, setOpen, DAYS, NAIRA, isPremium, daysLeft, grant, remove, info, gate };
