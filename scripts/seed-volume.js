'use strict';
// Runs before the server starts (npm start). On a host with a persistent disk (Railway volume...) set DATA_DIR=/data
// (or CONTENT_DIR). The game then keeps users AND all admin-managed content (puzzles, pictures, ads, pop-ups, slide,
// site texts, admin list) on that disk. The disk starts empty, so this copies the starter content from the code's
// content/ folder ONCE. It NEVER overwrites a file that already exists, so everything you add or change later
// (on the admin page) survives every redeploy. Specific variables (PUZZLES_FILE, IMAGE_DIR, ADS_DIR...) still work too.
const fs = require('fs');
const path = require('path');
const { CONTENT_DIR, REPO_CONTENT, copyMissing } = require('../src/paths');   // requiring it already copies the starter content
const env = process.env;

for (const d of [env.DATA_DIR, CONTENT_DIR, env.ADS_DIR, env.POPUPS_DIR, env.LOGINBG_DIR, env.WORLDBG_DIR]) if (d) fs.mkdirSync(d, { recursive: true });

function seedFile(file, name) {
  if (file && !fs.existsSync(file) && fs.existsSync(path.join(REPO_CONTENT, name))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(REPO_CONTENT, name), file);
    console.log('[seed] created', file);
  }
}

// Specific overrides (older setups)
seedFile(env.PUZZLES_FILE, 'puzzles.json');
seedFile(env.WORDSEARCH_FILE, 'wordsearch.json');
if (env.IMAGE_DIR) { const n = copyMissing(path.join(REPO_CONTENT, 'images'), env.IMAGE_DIR); if (n) console.log(`[seed] copied ${n} starter pictures to`, env.IMAGE_DIR); }
