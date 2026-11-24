'use strict';
// Quiz rooms: a host types questions (or pastes them), shares a code, and players race through them.
// This file holds the storage and the rules. The owner can lock the whole section from the Admin page.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sql, DATA_DIR } = require('./db');

sql.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    code TEXT PRIMARY KEY, host_id TEXT NOT NULL, title TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', secs INTEGER NOT NULL,
    questions TEXT NOT NULL, listed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', closes_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS quizzes_host ON quizzes (host_id, created_at);
  CREATE TABLE IF NOT EXISTS quiz_plays (
    code TEXT NOT NULL, user_id TEXT NOT NULL, started_at INTEGER NOT NULL, cur INTEGER NOT NULL DEFAULT 0, served_at INTEGER,
    results TEXT NOT NULL DEFAULT '[]', score INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, total_ms INTEGER NOT NULL DEFAULT 0,
    finished_at INTEGER, PRIMARY KEY (code, user_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS quiz_plays_user ON quiz_plays (user_id, started_at);
`);

// ---- limits ----
const LIMITS = { title: 60, topic: 40, question: 220, option: 90, explain: 200, minQ: 3, maxQ: 50, minOpt: 2, maxOpt: 4, minSecs: 8, maxSecs: 90, maxHosted: 30, perDay: 10 };
const BASE = 100, BONUS = 50, GRACE_MS = 2000;

// ---- owner settings (locked by default) ----
const SETTINGS = path.join(DATA_DIR, 'quiz.json');
let cfg = null;
function load() {
  if (cfg) return cfg;
  try { const j = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); cfg = { open: j.open === true, everyone: j.everyone === true, hosts: Array.isArray(j.hosts) ? j.hosts.map(String) : [] }; }
  catch { cfg = { open: false, everyone: false, hosts: [] }; }
  return cfg;
}
function persist() { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(cfg)); }
const isOpen = () => load().open;
const settings = () => ({ open: load().open, everyone: load().everyone, hosts: [...load().hosts] });
function setSettings({ open, everyone }) { const c = load(); if (open !== undefined) c.open = open === true; if (everyone !== undefined) c.everyone = everyone === true; persist(); }
function setHost(id, on) { const c = load(); const i = c.hosts.indexOf(id); if (on && i < 0) c.hosts.push(id); if (!on && i >= 0) c.hosts.splice(i, 1); persist(); }
const canHost = (u, admin) => !!u && (!!admin || load().everyone || load().hosts.includes(u.id));

// ---- text and question checks ----
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
function cleanQuestions(raw) {
  if (!Array.isArray(raw)) return { error: 'Add some questions.' };
  if (raw.length < LIMITS.minQ) return { error: `A quiz needs at least ${LIMITS.minQ} questions.` };
  if (raw.length > LIMITS.maxQ) return { error: `A quiz can have at most ${LIMITS.maxQ} questions.` };
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {}, n = i + 1;
    const q = clean(r.q, LIMITS.question);
    if (!q) return { error: `Question ${n} is empty.` };
    const opts = (Array.isArray(r.options) ? r.options : []).map((o) => clean(o, LIMITS.option));
    if (opts.length < LIMITS.minOpt || opts.length > LIMITS.maxOpt) return { error: `Question ${n} needs ${LIMITS.minOpt} to ${LIMITS.maxOpt} answers.` };
    if (opts.some((o) => !o)) return { error: `Question ${n} has an empty answer.` };
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return { error: `Question ${n} has two answers that are the same.` };
    const answer = Number(r.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= opts.length) return { error: `Mark the right answer for question ${n}.` };
    out.push({ q, options: opts, answer, explain: clean(r.explain, LIMITS.explain) });
  }
  return { questions: out };
}

// ---- codes ----
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let n = 0; n < 50; n++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += ALPHA[crypto.randomInt(ALPHA.length)];
    if (!sql.prepare('SELECT 1 FROM quizzes WHERE code = ?').get(c)) return c;
  }
  throw new Error('no free quiz code');
}

// ---- each player sees the answers in their own order, so copying a neighbour's screen does not help ----
function orderFor(code, userId, idx, n) {
  const seed = crypto.createHash('sha1').update(`${code}|${userId}|${idx}`).digest();
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = seed[i % seed.length] % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}
// Points for a right answer: 100, plus up to 50 for answering quickly.
const pointsFor = (ms, secs) => BASE + Math.round(BONUS * Math.max(0, 1 - ms / (secs * 1000)));

const rowOf = (code) => sql.prepare('SELECT * FROM quizzes WHERE code = ?').get(String(code || '').toUpperCase()) || null;
const parseQ = (row) => JSON.parse(row.questions);

module.exports = { LIMITS, GRACE_MS, isOpen, settings, setSettings, setHost, canHost, clean, cleanQuestions, newCode, orderFor, pointsFor, rowOf, parseQ };
