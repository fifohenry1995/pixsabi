'use strict';
// Every script file must at least parse: a typo in a page script (like admin.js) makes the whole page blank.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
let n = 0;
for (const dir of ['public/js', 'src', 'src/routes']) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (!f.endsWith('.js')) continue;
    try { execFileSync(process.execPath, ['--check', path.join(root, dir, f)], { stdio: 'pipe' }); n++; }
    catch (e) { console.error(`SYNTAX ERROR in ${dir}/${f}:\n${e.stderr}`); process.exit(1); }
  }
}
console.log(`  ok  ${n} script files parse`);
