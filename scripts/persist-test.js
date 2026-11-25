'use strict';
// Checks that with DATA_DIR set, content lives on the volume, is seeded once and never overwritten.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const clean = { ...process.env }; for (const k of ['DATA_DIR','CONTENT_DIR','PUZZLES_FILE','WORDSEARCH_FILE','IMAGE_DIR','ADS_DIR','POPUPS_DIR','LOGINBG_DIR','WORLDBG_DIR','SLIDE_FILE','SLIDE_DIR','SITE_FILE','ADMIN_FILE']) delete clean[k];
const vol = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-persist-'));
const run = (code, env) => spawnSync(process.execPath, ['-e', code], { cwd: root, env: { ...clean, ...env }, encoding: 'utf8' });

let r = run("console.log(require('./src/paths').CONTENT_DIR)", {});
ok(r.stdout.trim() === path.join(root, 'content'), 'no DATA_DIR -> repo content/ (unchanged behaviour)');
r = run("console.log(require('./src/paths').CONTENT_DIR)", { DATA_DIR: vol }); r.stdout = r.stdout.trim().split('\n').pop();
ok(r.stdout.trim() === path.join(vol, 'content'), 'DATA_DIR -> DATA_DIR/content');

r = spawnSync(process.execPath, ['scripts/seed-volume.js'], { cwd: root, env: { ...clean, DATA_DIR: vol }, encoding: 'utf8' });
const c = path.join(vol, 'content');
for (const f of ['puzzles.json', 'wordsearch.json', 'site.json', 'slide.json', 'admin.txt']) ok(fs.existsSync(path.join(c, f)), 'seeded ' + f);
ok(fs.existsSync(path.join(c, 'images')) && fs.readdirSync(path.join(c, 'images')).length > 0, 'seeded pictures');

// admin edits must survive the next start
fs.writeFileSync(path.join(c, 'puzzles.json'), '[{"mine":1}]');
fs.writeFileSync(path.join(c, 'images', 'my-new.jpg'), 'x');
spawnSync(process.execPath, ['scripts/seed-volume.js'], { cwd: root, env: { ...clean, DATA_DIR: vol }, encoding: 'utf8' });
ok(fs.readFileSync(path.join(c, 'puzzles.json'), 'utf8') === '[{"mine":1}]', 'second start does not overwrite puzzles');
ok(fs.existsSync(path.join(c, 'images', 'my-new.jpg')), 'second start keeps added pictures');

// modules really read from the volume; specific variable still wins
const src = fs.readFileSync(path.join(root, 'src/routes/admin.js'), 'utf8');
ok(/ADMIN_FILE/.test(src) && /paths/.test(src), 'admin list path follows CONTENT_DIR');
r = run("console.log(require('./src/adsPath').AD_DIR)", { DATA_DIR: vol });
ok(r.stdout.trim() === path.join(c, 'ads'), 'ads folder follows CONTENT_DIR');
r = run("console.log(require('./src/adsPath').AD_DIR)", { DATA_DIR: vol, ADS_DIR: '/x/ads' });
ok(r.stdout.trim() === '/x/ads', 'ADS_DIR still overrides');
fs.rmSync(vol, { recursive: true, force: true });
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('persist-test passed');
