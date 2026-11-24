'use strict';
// Run with: npm test (or: node scripts/raceclean-test.js)
// Checks the hourly clean-up: finished/cancelled races older than 5 days are deleted; newer, running and sponsored ones stay.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naija-sabi-raceclean-'));
const { db, sql } = require('../src/db');
require('../src/routes/challenges')({ route: () => {} });
const R = require('../src/routes/challenges');
const DAY = 24 * 3600 * 1000, now = Date.now();
const mk = (id, status, endedDaysAgo, extra = {}) => {
  db.challenges[id] = { id, race: true, status, createdAt: now - (endedDaysAgo + 1) * DAY, endedAt: endedDaysAgo == null ? 0 : now - endedDaysAgo * DAY, players: {}, ...extra };
};
mk('OLDFIN', 'finished', 6); mk('OLDCAN', 'cancelled', 9); mk('NEWFIN', 'finished', 2);
mk('SPONSR', 'finished', 30, { sponsor: { reportToken: 't' } }); mk('RUNNIN', 'active', 40, { startedAt: now - 60000 });
mk('ENDEDRECENT', 'finished', 4.9);
R.sweepStale();
const has = (id) => !!db.challenges[id];
assert(!has('OLDFIN') && !has('OLDCAN'), 'old finished/cancelled deleted');
assert(has('NEWFIN') && has('ENDEDRECENT'), 'recent finished kept');
assert(has('SPONSR'), 'sponsored kept');
assert(has('RUNNIN'), 'running kept (ended by the abandon rule, not deleted)');
assert.strictEqual(sql.prepare("SELECT COUNT(*) n FROM challenges WHERE id IN ('OLDFIN','OLDCAN')").get().n, 0);
console.log('  ok  old races are deleted after 5 days, everything else stays');
