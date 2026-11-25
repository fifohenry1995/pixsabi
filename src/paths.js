'use strict';
// One place that says where the admin-managed files live (puzzles, pictures, ads, pop-ups, slide, site texts, admin list...).
//  - CONTENT_DIR set            -> use that folder
//  - else DATA_DIR set          -> DATA_DIR/content   (so ONE Railway volume keeps users AND content)
//  - else                       -> the content/ folder next to the code (as before)
// Specific variables (PUZZLES_FILE, IMAGE_DIR, ADS_DIR ...) still win over this.
const fs = require('fs');
const path = require('path');
const REPO_CONTENT = path.join(__dirname, '..', 'content');
const CONTENT_DIR = process.env.CONTENT_DIR
  || (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'content') : REPO_CONTENT);

// When content lives on another disk, copy the starter files over ONCE (never overwrites). Safe to run on every start.
function copyMissing(src, dst) {
  let n = 0;
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) n += copyMissing(s, d);
    else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}
let seeded = 0;
if (path.resolve(CONTENT_DIR) !== path.resolve(REPO_CONTENT)) {
  try { seeded = copyMissing(REPO_CONTENT, CONTENT_DIR); } catch (e) { console.error('[content] could not copy starter files:', e.message); }
  if (seeded) console.log(`[seed] copied ${seeded} starter content files to`, CONTENT_DIR);
}
module.exports = { CONTENT_DIR, REPO_CONTENT, copyMissing };
