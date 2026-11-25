'use strict';
// Pop-up adverts: a picture, GIF or short video shown after a player finishes every Nth level.
// Files live in content/popups/ and the list and settings in content/popups/popups.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.POPUPS_DIR || path.join(require('./paths').CONTENT_DIR, 'popups');
const META = path.join(DIR, 'popups.json');
const MAX_ITEMS = 10;

// What can be uploaded. `magic` checks the real file bytes, not just the name the browser claims.
const TYPES = {
  'image/jpeg': { kind: 'image', ext: 'jpg', max: 800_000, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { kind: 'image', ext: 'png', max: 800_000, magic: (b) => b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' },
  'image/gif': { kind: 'gif', ext: 'gif', max: 2_500_000, magic: (b) => /^GIF8[79]a/.test(b.toString('latin1', 0, 6)) },
  'video/mp4': { kind: 'video', ext: 'mp4', max: 4_000_000, magic: (b) => b.toString('latin1', 4, 8) === 'ftyp' },
  'video/webm': { kind: 'video', ext: 'webm', max: 4_000_000, magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, t]) => [t.ext, mime]));

const DEFAULTS = { enabled: true, every: 10, closeAfter: 4 };

function read() {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(META, 'utf8')); } catch { /* none yet */ }
  // Google does not allow its ads in pop-ups, so any AdSense pop-up saved by an older version is ignored.
  return { settings: { ...DEFAULTS, ...(m.settings || {}) }, items: Array.isArray(m.items) ? m.items.filter((i) => i && i.kind !== 'adsense') : [] };
}
function write(m) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = META + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1) + '\n');
  fs.renameSync(tmp, META);
}

const newId = () => crypto.randomBytes(5).toString('hex'); // 10 hex characters
const fileOf = (item) => path.join(DIR, `${item.id}.${item.ext}`);
const urlOf = (item) => `/popup/${item.id}`;
const Adsense = require('./adsense');
const hasFile = (i) => (i.kind === 'adsense' ? Adsense.live() && !!Adsense.cleanAd(i.adsense) : fs.existsSync(fileOf(i)));
const find = (id) => read().items.find((i) => i.id === id) || null;

// What players get: only active adverts, and nothing at all when pop-ups are switched off.
function publicView() {
  const { settings, items } = read();
  const active = items.filter((i) => i.active && hasFile(i));
  if (!settings.enabled || !active.length) return { enabled: false, every: settings.every, closeAfter: settings.closeAfter, items: [] };
  const adOf = (i) => (i.kind === 'adsense' ? { adsense: Adsense.cleanAd(i.adsense) } : {});
  return {
    enabled: true, every: settings.every, closeAfter: settings.closeAfter,
    items: active.map((i) => ({ id: i.id, kind: i.kind, url: i.kind === 'adsense' ? '' : urlOf(i), link: i.link || '', title: i.title || '', ...adOf(i) })),
  };
}

module.exports = { hasFile, DIR, MAX_ITEMS, TYPES, MIME_BY_EXT, DEFAULTS, read, write, newId, fileOf, urlOf, find, publicView };
