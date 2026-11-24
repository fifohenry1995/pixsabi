'use strict';
// Contact and social links (set by the owner on the Admin page). The owner can type a handle, a number or a full link;
// we turn each one into a safe https link on the right website, so nothing else (no scripts, no other sites) can be set.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'social.json');
const KINDS = ['contact', 'channel', 'x', 'instagram', 'tiktok', 'facebook'];
const MESSAGE = 'Hello PixSabi, I am writing from the game. ';

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, '').trim().slice(0, n);

// A link the person typed: must be https (or typed without a scheme) on one of the allowed websites. Returns the URL object or null.
function asUrl(raw, hosts) {
  let t = raw.trim();
  if (!/^https?:\/\//i.test(t)) { if (!/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t)) return null; t = 'https://' + t; }
  let u; try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (!hosts.includes(host)) return null;
  u.protocol = 'https:'; u.username = ''; u.password = '';
  return u;
}
const handleOf = (raw, re) => { const h = raw.replace(/^@/, '').trim(); return re.test(h) ? h : ''; };

// One field: returns { url, label } (label = what to show) or { error } or null when left empty.
function normalize(kind, rawIn) {
  const raw = clean(rawIn, 200);
  if (!raw) return null;
  const bad = (msg) => ({ error: msg });
  if (kind === 'contact') {
    let d = raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
    if (/^0\d{10}$/.test(d)) d = '234' + d.slice(1);          // 0803... -> 234803...
    if (!/^\d{10,15}$/.test(d)) return bad('Type your WhatsApp number with the country code, e.g. 2348012345678.');
    return { url: `https://wa.me/${d}?text=${encodeURIComponent(MESSAGE)}`, label: '+' + d };
  }
  if (kind === 'channel') {
    const u = asUrl(raw, ['whatsapp.com', 'chat.whatsapp.com']);
    if (!u || !/^\/(channel\/|[A-Za-z0-9]{10,})/.test(u.pathname)) return bad('Paste the WhatsApp channel link (it looks like https://whatsapp.com/channel/...).');
    return { url: u.origin + u.pathname, label: '' };
  }
  const SITES = {
    x: { hosts: ['x.com', 'twitter.com'], re: /^[A-Za-z0-9_]{1,15}$/, make: (h) => `https://x.com/${h}`, name: 'X (Twitter)' },
    instagram: { hosts: ['instagram.com', 'instagr.am'], re: /^[A-Za-z0-9._]{1,30}$/, make: (h) => `https://www.instagram.com/${h}/`, name: 'Instagram' },
    tiktok: { hosts: ['tiktok.com'], re: /^[A-Za-z0-9._]{2,24}$/, make: (h) => `https://www.tiktok.com/@${h}`, name: 'TikTok' },
    facebook: { hosts: ['facebook.com', 'fb.com', 'fb.me'], re: /^[A-Za-z0-9.\-]{5,50}$/, make: (h) => `https://www.facebook.com/${h}`, name: 'Facebook' },
  }[kind];
  if (!SITES) return bad('Unknown field.');
  if (/^https?:\/\/|\//i.test(raw)) {
    const u = asUrl(raw, SITES.hosts);
    if (!u) return bad(`That is not a valid ${SITES.name} link.`);
    const first = u.pathname.split('/').filter(Boolean)[0] || '';
    const h = first.replace(/^@/, '');
    // pages like facebook.com/profile.php?id=... or share links keep their path and id
    if (kind === 'facebook' && (first === 'profile.php' || first === 'people' || first === 'groups' || first === 'pages')) {
      const keep = first === 'profile.php' ? `?id=${encodeURIComponent(u.searchParams.get('id') || '')}` : '';
      if (first === 'profile.php' && !/^\d+$/.test(u.searchParams.get('id') || '')) return bad('That Facebook link has no page.');
      return { url: `https://www.facebook.com${u.pathname}${keep}`, label: '' };
    }
    if (!h || !SITES.re.test(h)) return bad(`That ${SITES.name} link does not point to a page or profile.`);
    return { url: SITES.make(h), label: kind === 'x' || kind === 'instagram' || kind === 'tiktok' ? '@' + h : h };
  }
  const h = handleOf(raw, SITES.re);
  if (!h) return bad(`That is not a valid ${SITES.name} handle.`);
  return { url: SITES.make(h), label: kind === 'x' || kind === 'instagram' || kind === 'tiktok' ? '@' + h : h };
}

function read() {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* nothing saved yet */ }
  const out = {};
  for (const k of KINDS) out[k] = typeof m[k] === 'string' ? m[k] : '';
  return out;
}
function write(m) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(m)); fs.renameSync(FILE + '.tmp', FILE); }

// What players get: only the fields that are filled in, already turned into safe links.
function publicLinks() {
  const m = read(), out = [];
  for (const k of KINDS) { const r = normalize(k, m[k]); if (r && r.url) out.push({ kind: k, url: r.url, label: r.label }); }
  return out;
}

module.exports = { KINDS, normalize, read, write, publicLinks, clean };
