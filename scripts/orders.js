'use strict';
// Lists coin purchases:  npm run orders
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const sql = new DatabaseSync(path.join(DATA_DIR, 'pixsabi.db'), { readOnly: true });
let rows;
try { rows = sql.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50').all(); }
catch { console.log('No purchases yet.'); process.exit(0); }
const paid = rows.filter((r) => r.status === 'paid');
for (const r of rows) {
  const when = new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ');
  console.log(`${when}  ${r.status.padEnd(8)} ${r.user_id.padEnd(20)} ${String(r.coins).padStart(5)} coins  N${(r.amount_kobo / 100).toLocaleString('en-NG').padStart(7)}  ${r.email || ''}`);
}
const total = sql.prepare("SELECT COALESCE(SUM(amount_kobo),0) AS k, COUNT(*) AS n FROM orders WHERE status = 'paid'").get();
console.log(`\nPaid orders: ${total.n}   Total: N${(Number(total.k) / 100).toLocaleString('en-NG')}   (showing the latest ${rows.length}; ${paid.length} paid among them)`);
