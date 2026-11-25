'use strict';
// Run with: npm test. A game running under the old file name (naija-sabi.db) must keep every player after the rename to pixsabi.db.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-rename-'));
process.env.DATA_DIR = dir;
const old = new DatabaseSync(path.join(dir, 'naija-sabi.db'));
old.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO meta VALUES ('rename-check', 'kept');");
old.close();
const { sql } = require('../src/db');
assert.ok(fs.existsSync(path.join(dir, 'pixsabi.db')), 'the new file exists');
assert.ok(!fs.existsSync(path.join(dir, 'naija-sabi.db')), 'the old file is gone (renamed, not copied)');
assert.strictEqual(sql.prepare("SELECT v FROM meta WHERE k = 'rename-check'").get().v, 'kept');
console.log('  ok  an existing naija-sabi.db is renamed to pixsabi.db with its data');
process.exit(0);
