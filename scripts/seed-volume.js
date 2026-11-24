'use strict';
// Runs before the server starts (npm start). On a host with a persistent disk (Railway volume, Render disk...)
// you point DATA_DIR, PUZZLES_FILE, WORDSEARCH_FILE, IMAGE_DIR, ADS_DIR, POPUPS_DIR, LOGINBG_DIR and WORLDBG_DIR at that disk.
// The disk starts empty, so this copies your starter puzzles and pictures onto it ONCE (it never overwrites
// anything, so puzzles and pictures you add later on the admin page are safe). With no such variables it does nothing.
const fs = require('fs');
const path = require('path');

const content = path.join(__dirname, '..', 'content');
const env = process.env;

for (const d of [env.DATA_DIR, env.ADS_DIR, env.POPUPS_DIR, env.LOGINBG_DIR, env.WORLDBG_DIR]) if (d) fs.mkdirSync(d, { recursive: true });

if (env.PUZZLES_FILE && !fs.existsSync(env.PUZZLES_FILE)) {
  fs.mkdirSync(path.dirname(env.PUZZLES_FILE), { recursive: true });
  fs.copyFileSync(path.join(content, 'puzzles.json'), env.PUZZLES_FILE);
  console.log('[seed] created', env.PUZZLES_FILE);
}
if (env.WORDSEARCH_FILE && !fs.existsSync(env.WORDSEARCH_FILE)) {
  fs.mkdirSync(path.dirname(env.WORDSEARCH_FILE), { recursive: true });
  fs.copyFileSync(path.join(content, 'wordsearch.json'), env.WORDSEARCH_FILE);
  console.log('[seed] created', env.WORDSEARCH_FILE);
}
if (env.IMAGE_DIR) {
  fs.mkdirSync(env.IMAGE_DIR, { recursive: true });
  const src = path.join(content, 'images');
  let n = 0;
  if (fs.existsSync(src)) {
    for (const f of fs.readdirSync(src)) {
      const to = path.join(env.IMAGE_DIR, f);
      if (!fs.existsSync(to) && fs.statSync(path.join(src, f)).isFile()) { fs.copyFileSync(path.join(src, f), to); n++; }
    }
  }
  if (n) console.log(`[seed] copied ${n} starter pictures to`, env.IMAGE_DIR);
}
