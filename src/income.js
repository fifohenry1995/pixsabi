'use strict';
// The owner's income tracker. Coin and premium sales come from the payment records by themselves; AdSense, sponsored races
// and anything else are typed in by the owner (the game cannot read AdSense). Amounts are kept in naira. An amount typed in
// dollars is converted with the rate the owner types (naira per dollar), and both are kept so the entry can be checked later.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, orders } = require('./db');

const FILE = path.join(DATA_DIR, 'income.json');
const KINDS = { adsense: 'AdSense', sponsor: 'Sponsored races', other: 'Other' };
const MAX_ENTRIES = 2000;

function read() {
  try { const m = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(m.entries) ? m.entries : []; } catch { return []; }
}
function write(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 1) + '\n');
  fs.renameSync(tmp, FILE);
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// Checks one typed entry. Returns { entry } or { error }.
function parse(b) {
  const kind = String(b.kind || '');
  if (!KINDS[kind]) return { error: 'Choose AdSense, Sponsored races or Other.' };
  const month = String(b.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2024 || Number(month.slice(0, 4)) > 2100) return { error: 'Choose the month this money is for.' };
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return { error: 'Type an amount above zero.' };
  const currency = b.currency === 'USD' ? 'USD' : 'NGN';
  let rate = 1;
  if (currency === 'USD') {
    rate = Number(b.rate);
    if (!Number.isFinite(rate) || rate < 1 || rate > 100000) return { error: 'Type the naira rate for one dollar (for example the rate your bank used).' };
  }
  const naira = Math.round(amount * rate * 100) / 100;
  return { entry: { id: crypto.randomBytes(6).toString('hex'), month, kind, currency, amount: Math.round(amount * 100) / 100, rate, naira, note: clean(b.note, 80), at: Date.now() } };
}

function add(b) {
  const r = parse(b);
  if (r.error) return r;
  const all = read();
  if (all.length >= MAX_ENTRIES) return { error: 'Too many entries. Delete some old ones first.' };
  all.push(r.entry); write(all);
  return r;
}
function remove(id) {
  const all = read(), left = all.filter((e) => e.id !== String(id));
  if (left.length === all.length) return false;
  write(left); return true;
}

// Months newest first. Each row: coins, premium, adsense, sponsor, other, total (all in naira).
function summary(limit = 12) {
  const rows = new Map();
  const row = (m) => { if (!rows.has(m)) rows.set(m, { month: m, coins: 0, premium: 0, adsense: 0, sponsor: 0, other: 0, total: 0 }); return rows.get(m); };
  for (const o of orders.paidByMonth()) { if (o.month) row(o.month)[o.pack] += o.kobo / 100; }
  for (const e of read()) row(e.month)[e.kind] += e.naira;
  const out = [...rows.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, Math.max(1, Math.min(36, Number(limit) || 12)));
  for (const r of out) { for (const k of ['coins', 'premium', 'adsense', 'sponsor', 'other']) r[k] = Math.round(r[k] * 100) / 100; r.total = Math.round((r.coins + r.premium + r.adsense + r.sponsor + r.other) * 100) / 100; }
  return out;
}
const entries = (limit = 100) => read().sort((a, b) => b.at - a.at).slice(0, limit);

module.exports = { FILE, KINDS, parse, add, remove, summary, entries };
