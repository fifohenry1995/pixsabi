'use strict';
// Run with: npm run validate
// Checks every puzzle in content/puzzles.json so a typo never reaches players.
const puzzles = require('../content/puzzles.json');
const { imageFile, imageIndex } = require('../src/puzzles');

const problems = [];
const seen = new Set();
const cats = {};
let oldNames = 0;
const index = imageIndex();
let withPicture = 0;

puzzles.forEach((p, i) => {
  const tag = `#${i + 1} ${p.a || '(no answer)'}`;
  if (!/^[A-Z]{3,12}$/.test(p.a || '')) problems.push(`${tag}: answer must be 3-12 capital letters A-Z, no spaces`);
  if (seen.has(p.a)) problems.push(`${tag}: duplicate answer`);
  seen.add(p.a);
  if (!p.c) problems.push(`${tag}: missing category (c): use Naija or Universal`);
  else if (p.c !== 'Naija' && p.c !== 'Universal') oldNames++; // old names like Food still work: they play as Naija
  if (!p.clue) problems.push(`${tag}: missing clue`);
  if (!p.fact) problems.push(`${tag}: missing fact`);
  cats[p.c] = (cats[p.c] || 0) + 1;

  // Each puzzle needs ONE picture (content/images/<answer>.jpg) or, until you have it, 4 emoji tiles.
  const hasTiles = Array.isArray(p.t) && p.t.length === 4 && p.t.every((t) => t && typeof t === 'string');
  if (p.t != null && !hasTiles) problems.push(`${tag}: "t" must be exactly 4 tiles (or leave it out once the puzzle has a picture)`);
  const id = String(p.a || '').toLowerCase();
  if (p.img && /^https?:\/\//i.test(p.img)) problems.push(`${tag}: picture links are not supported. Save the file in content/images and use its file name`);
  const file = imageFile({ id, img: p.img || null }, index);
  if (p.img && !/^https?:\/\//i.test(p.img) && !file) problems.push(`${tag}: "img" says ${p.img} but that file is not in content/images`);
  if (file) withPicture++;
  else if (!hasTiles) problems.push(`${tag}: needs a picture named ${id}.jpg in content/images (or 4 emoji tiles in "t")`);
});

if (problems.length) {
  console.error(`Found ${problems.length} problem(s):\n- ` + problems.join('\n- '));
  process.exit(1);
}
if (oldNames) console.log(`Note: ${oldNames} puzzle(s) still use an old category name. They play as Naija. Open them in the admin page and save to switch them to Naija or Universal.`);
console.log(`OK: ${puzzles.length} puzzles, ${withPicture} with a picture`, cats);
if (withPicture < puzzles.length) {
  console.log(`${puzzles.length - withPicture} still use emoji tiles. Run "npm run images" to see which pictures are missing.`);
}
