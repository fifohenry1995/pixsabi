'use strict';
// Run with: npm test (or: node scripts/image-test.js)
// Checks that a puzzle shows ONE collage picture when its file exists, falls back to
// emoji tiles when it does not, and never exposes the answer through the id or the link.
// Uses throwaway folders, never your real images or data.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-images-'));
process.env.IMAGE_DIR = dir;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-imgdata-'));
const P = require('../src/puzzles');

const [a, b, c, d, e, f] = P.puzzles.slice(0, 6);
const put = (name) => fs.writeFileSync(path.join(dir, name), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
const PIC_URL = /^\/pic\/[0-9a-f]{16}\?v=\d+$/;

let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

// 1. no picture yet: emoji tiles (when the puzzle has them), no image
const before = P.view(a);
assert.strictEqual(before.image, null);
if (a.tiles) assert.strictEqual(before.tiles.length, 4);
ok('without a picture file the puzzle falls back to its emoji tiles');

// 2. a file named after the answer is picked up with no other change
put(`${a.id}.jpg`);
const v = P.view(a);
assert.ok(PIC_URL.test(v.image), v.image);
assert.strictEqual(v.tiles, null, 'tiles are not sent when there is a picture');
assert.ok(!('answer' in v) && !('clue' in v) && !('fact' in v), 'answer, clue and fact stay on the server');
assert.strictEqual(path.basename(P.imageFile(a)), `${a.id}.jpg`);
ok('<answer>.jpg in the pictures folder becomes the puzzle picture automatically');

// 3. the answer cannot be read from the id or the picture link
for (const p of P.puzzles) {
  const pid = P.publicId(p);
  assert.ok(/^[0-9a-f]{16}$/.test(pid));
  assert.notStrictEqual(pid, p.id);
  assert.strictEqual(P.fromPublic(pid), p);
  assert.strictEqual(P.view(p).id, pid);
}
assert.strictEqual(new Set(P.puzzles.map((p) => P.publicId(p))).size, P.puzzles.length, 'public ids must be unique');
assert.strictEqual(P.fromPublic(a.id), null, 'the real id must not work as a public id');
assert.strictEqual(P.fromPublic('0000000000000000'), null);
assert.ok(!v.image.toLowerCase().includes(a.id.toLowerCase()) || a.id.length <= 3, 'picture link must not contain the answer');
assert.ok(!v.image.includes('.jpg') && !v.image.includes('/images/'), 'picture link must not contain a file name');
ok('the browser only gets random ids and picture links, never the answer or a file name');

// 4. other formats and capital letters
put(`${b.id.toUpperCase()}.PNG`);
assert.ok(PIC_URL.test(P.view(b).image) && P.imageFile(b).toLowerCase().endsWith('.png'));
put(`${c.id}.webp`);
assert.ok(PIC_URL.test(P.view(c).image));
ok('png, jpeg and webp work, and capital letters in the file name do not matter');

// 5. explicit img field, a path that tries to escape, and links are ignored
const withImg = { ...d, img: 'my-collage.jpg' };
assert.strictEqual(P.view(withImg).image, null, 'missing explicit file means no picture');
put('my-collage.jpg');
assert.ok(PIC_URL.test(P.view(withImg).image));
assert.strictEqual(path.basename(P.imageFile({ ...d, img: '/images/my-collage.jpg' })), 'my-collage.jpg');
assert.strictEqual(P.imageFile({ ...d, img: '../../package.json' }), null);
assert.strictEqual(P.imageFile({ ...d, img: 'https://example.com/x.jpg' }), null, 'outside links are not used');
ok('an img field can name a file, and cannot reach outside the pictures folder');

// 6. replacing the file changes the link so browsers load the new picture
const first = P.view(a).image;
const later = new Date(Date.now() + 5000);
fs.utimesSync(path.join(dir, `${a.id}.jpg`), later, later);
assert.notStrictEqual(P.view(a).image, first);
ok('replacing a picture changes its link, so players never see an old one');

// 7. unrelated files are ignored
put(`${e.id}-typo.jpg`);
assert.strictEqual(P.view(e).image, null);
assert.strictEqual(P.view(f).image, null);
ok('files with the wrong name are ignored');

console.log(`\nAll ${passed} picture checks passed.`);
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(0);
