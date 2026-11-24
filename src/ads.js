'use strict';
// Advertisement pictures shown beside the game on laptops and big screens.
// Six slots: 1 to 3 on the left, 4 to 6 on the right. The admin page uploads the pictures; they are saved in content/ads/
// as 1.jpg ... 6.jpg (or 1.gif ... 6.gif for animated adverts), with the link and label for each in content/ads/ads.json.
const fs = require('fs');
const path = require('path');

const { AD_DIR } = require('./adsPath');
const Adsense = require('./adsense');
const META = path.join(AD_DIR, 'ads.json');
const SLOTS = [1, 2, 3, 4, 5, 6];
const LEFT_SLOTS = 3; // slots 1..3 are on the left, the rest on the right

const EXTS = ['jpg', 'gif'];
const pathFor = (slot, ext) => path.join(AD_DIR, `${slot}.${ext}`);
// The saved file for a slot: a JPEG or an animated GIF (whichever was uploaded last). Falls back to the .jpg name.
function fileOf(slot) {
  for (const ext of EXTS) { try { if (fs.statSync(pathFor(slot, ext)).isFile()) return pathFor(slot, ext); } catch { /* try next */ } }
  return pathFor(slot, 'jpg');
}
const isGif = (slot) => fileOf(slot).endsWith('.gif');
function clear(slot) { for (const ext of EXTS) { try { fs.unlinkSync(pathFor(slot, ext)); } catch { /* not there */ } } }

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return {}; }
}
function writeMeta(meta) {
  fs.mkdirSync(AD_DIR, { recursive: true });
  const tmp = META + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 1) + '\n');
  fs.renameSync(tmp, META);
}

// What players (and the admin page) get: only slots that have a picture.
function list() {
  const meta = readMeta();
  const out = [];
  for (const slot of SLOTS) {
    // A slot with AdSense code (while AdSense is switched on) shows that instead of a picture.
    const gad = Adsense.sideAd(slot);
    if (gad) { out.push({ slot, side: slot <= LEFT_SLOTS ? 'left' : 'right', adsense: gad, link: '', alt: '', advertiser: 'Google AdSense', gif: false }); continue; }
    let st;
    try { st = fs.statSync(fileOf(slot)); } catch { continue; }
    if (!st.isFile()) continue;
    const m = meta[slot] || {};
    out.push({ slot, side: slot <= LEFT_SLOTS ? 'left' : 'right', image: `/ad/${slot}?v=${Math.floor(st.mtimeMs)}`, link: m.link || '', alt: m.alt || '', advertiser: m.advertiser || '', gif: isGif(slot) });
  }
  return out;
}

module.exports = { AD_DIR, SLOTS, fileOf, pathFor, clear, isGif, readMeta, writeMeta, list };
