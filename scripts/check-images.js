'use strict';
// Run with: npm run images
// Shows which puzzles already have their collage picture, which are still missing,
// and which files in content/images do not match any puzzle (usually a typo in the name).
const path = require('path');
const { puzzles, imageFile, imageIndex, IMAGE_DIR, IMAGE_DIRS, IMAGE_EXTS } = require('../src/puzzles');

const index = imageIndex();
const has = [];
const missing = [];
const used = new Set();

for (const p of puzzles) {
  const file = imageFile(p, index);
  if (file) {
    has.push(p);
    if (p.img && !/^https?:\/\//i.test(p.img)) used.add(path.basename(p.img).toLowerCase());
    for (const ext of IMAGE_EXTS) used.add(p.id + ext);
  } else {
    missing.push(p);
  }
}

console.log(`Pictures folder: ${IMAGE_DIR}`);
const legacy = IMAGE_DIRS.slice(1).filter((d) => [...index.values()].some((v) => v.file.startsWith(d)));
if (legacy.length) console.log(`Some pictures are still in the old folder (${legacy.join(', ')}). They work, but please move them to the folder above. The old folder is never served to players.`);
console.log(`${has.length} of ${puzzles.length} puzzles have a picture.\n`);

if (missing.length) {
  console.log('Still missing (save each picture with exactly this name):');
  const byCat = {};
  for (const p of missing) (byCat[p.category] = byCat[p.category] || []).push(p);
  for (const [cat, list] of Object.entries(byCat)) {
    console.log(`\n${cat}`);
    for (const p of list) console.log(`  ${(p.id + '.jpg').padEnd(22)} answer: ${p.answer}`);
  }
} else {
  console.log('Every puzzle has a picture.');
}

const strays = [...index.keys()].filter((n) => /\.(jpe?g|png|webp)$/.test(n) && !used.has(n));
if (strays.length) {
  console.log('\nThese files match no puzzle, so they are not used. Check the spelling:');
  for (const n of strays) console.log('  ' + index.get(n).name);
}
