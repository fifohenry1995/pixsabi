'use strict';
// Contest commentary: settings, and the audio adverts played during the "commercial break".
// The announcer's voice is made on the listener's own phone or computer (the browser's speech voice), so nothing about the voice is stored here.
// Audio adverts are short sound files uploaded on the admin page. Files live in content/commentary/ and the list in commentary.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.COMMENTARY_DIR || path.join(require('./paths').CONTENT_DIR, 'commentary');
const META = path.join(DIR, 'commentary.json');
const MAX_ADS = 8;
const MAX_BYTES = 900_000;                 // about 30 to 60 seconds of a normal MP3

// What can be uploaded. The real file bytes decide the type, not the name the browser claims.
const TYPES = [
  { ext: 'mp3', mime: 'audio/mpeg', magic: (b) => b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: 'm4a', mime: 'audio/mp4', magic: (b) => b.toString('latin1', 4, 8) === 'ftyp' },
  { ext: 'ogg', mime: 'audio/ogg', magic: (b) => b.toString('latin1', 0, 4) === 'OggS' },
  { ext: 'wav', mime: 'audio/wav', magic: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE' },
];
const MIME_BY_EXT = Object.fromEntries(TYPES.map((t) => [t.ext, t.mime]));
const typeOf = (buf) => TYPES.find((t) => t.magic(buf)) || null;

const DEFAULTS = { enabled: true, breakEvery: 3, readBios: true };

function read() {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(META, 'utf8')); } catch { /* none yet */ }
  return { settings: { ...DEFAULTS, ...(m.settings || {}) }, ads: Array.isArray(m.ads) ? m.ads : [] };
}
function write(m) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = META + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1) + '\n');
  fs.renameSync(tmp, META);
}
const newId = () => crypto.randomBytes(5).toString('hex');
const fileOf = (ad) => path.join(DIR, `${ad.id}.${ad.ext}`);
const urlOf = (ad) => `/audioad/${ad.id}`;
const find = (id) => read().ads.find((a) => a.id === id) || null;
const live = (m) => m.ads.filter((a) => a.active && fs.existsSync(fileOf(a)));

// What a player's device needs to know. Premium members never get the audio break (like the pop-up adverts).
function configFor(isPremium) {
  const m = read();
  return {
    enabled: !!m.settings.enabled, breakEvery: m.settings.breakEvery, readBios: !!m.settings.readBios,
    hasAds: !isPremium && live(m).length > 0,
  };
}

// The next audio advert, taking turns. The play is counted when it is handed out.
let turn = 0;
function nextAd() {
  const m = read();
  const ads = live(m);
  if (!ads.length) return null;
  const ad = ads[turn++ % ads.length];
  const stored = m.ads.find((a) => a.id === ad.id);
  stored.plays = (stored.plays || 0) + 1;
  write(m);
  return { id: ad.id, url: urlOf(ad), label: ad.label || '' };
}

module.exports = { DIR, MAX_ADS, MAX_BYTES, TYPES, MIME_BY_EXT, DEFAULTS, typeOf, read, write, newId, fileOf, urlOf, find, configFor, nextAd };
