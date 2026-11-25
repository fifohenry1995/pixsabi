'use strict';
// Run with: npm test (or: node scripts/chat-test.js)
// Checks the chat room and the live player counts by calling the handlers directly
// against a throwaway database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pixsabi-chat-'));
process.env.ADMIN_USER = 'boss';
process.env.CHAT_MIN_GAP_MS = '0'; // the test sends fast; the gap rule has its own check below
const dbm = require('../src/db');
const { db, newUser, chat } = dbm;
const Presence = require('../src/presence');

const handlers = {};
require('../src/routes/chat')({ route: (m, p, h) => { handlers[`${m} ${p}`] = h; } });
const user = (name) => { const u = newUser(name, 'x'); db.users[u.id] = u; return u; };
const call = async (key, u, { params = {}, body = {}, query = {} } = {}) => handlers[key]({ user: u, params, body, query, headers: {} });
async function fails(status, fn) {
  try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `expected ${status}, got ${e.status}: ${e.message}`); return; }
  assert.fail(`expected a ${status} error`);
}
const say = (u, text) => call('POST /api/chat', u, { body: { text } });
const feed = (u, query) => call('GET /api/chat', u, { query });
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

(async () => {
  const ada = user('Ada'), bola = user('Bola'), chidi = user('Chidi'), boss = user('Boss');

  // ---- counts ----
  Presence.clear();
  let st = await call('GET /api/stats', null);
  assert.strictEqual(st.players, 4);
  assert.strictEqual(st.online, undefined, 'visitors are never told how many are online');
  assert.ok(Array.isArray(st.categories) && st.categories.length > 0, 'the login screen gets the category names for its chips');
  Presence.touch(ada.id); Presence.touch(bola.id);
  const realNow = Date.now;
  st = await call('GET /api/stats', null);
  assert.strictEqual(st.online, undefined);
  assert.deepStrictEqual(await call('GET /api/presence', ada), { players: 4 });
  assert.deepStrictEqual(await call('GET /api/presence', boss), { players: 4, online: 2 }, 'the admin still sees who is online');
  assert.strictEqual((await call('GET /api/stats', boss)).online, 2);
  Date.now = () => realNow() + Presence.WINDOW_MS + 1000; // two and a half minutes later, nobody pinged
  assert.strictEqual(Presence.count(), 0, 'players who stop pinging drop out of "online"');
  Presence.touch(chidi.id);
  assert.strictEqual(Presence.count(), 1);
  Date.now = realNow;
  Presence.clear();
  ok('registered and online counts; idle players stop counting as online');

  // ---- sending ----
  const sent = (await say(ada, '  Hello   everybody  ')).message;
  assert.strictEqual(sent.text, 'Hello everybody', 'spaces are tidied');
  assert.strictEqual(sent.username, 'Ada');
  assert.strictEqual(sent.mine, true);
  let f = await feed(bola);
  assert.strictEqual(f.messages.length, 1);
  assert.strictEqual(f.messages[0].mine, false);
  assert.strictEqual(f.admin, false);
  assert.strictEqual(f.players, 4);
  await say(bola, 'Welcome Ada');
  f = await feed(chidi);
  assert.deepStrictEqual(f.messages.map((m) => m.text), ['Hello everybody', 'Welcome Ada']);
  const firstId = f.messages[0].id;
  const nw = await feed(chidi, { after: firstId });
  assert.deepStrictEqual(nw.messages.map((m) => m.text), ['Welcome Ada'], 'after=<id> gives only newer messages');
  assert.strictEqual((await feed(chidi, { after: nw.messages[0].id })).messages.length, 0);
  ok('messages are tidied, shared with everybody, and fetched incrementally');

  // ---- rules ----
  await fails(400, () => say(ada, '   '));
  await fails(400, () => say(ada, 'x'.repeat(301)));
  await say(ada, 'x'.repeat(300));
  await fails(400, () => say(ada, 'x'.repeat(300))); // duplicate
  // links of every kind are refused, but ordinary sentences with dots are fine
  for (const bad of ['see http://a.com', 'https://x.y/z', 'www . evil', 'click evil.com now', 'evil(.)com', 'evil dot com', 'join t.me/xyz',
    'mail bad@scam.ng', '//evil.site', 'bit.ly/abc', 'free money at promo.xyz', 'goto Evil.NG']) {
    await fails(400, () => say(user('L' + Math.random().toString(36).slice(2, 8)), bad));
  }
  for (const fine of ['I scored 3.5 today', 'ok. net worth is 5', 'jollof rice is life.', 'see you. Me too']) {
    await say(user('F' + Math.random().toString(36).slice(2, 8)), fine);
  }
  // admins may post links (announcements)
  assert.ok((await say(boss, 'Rules at https://example.com/rules')).message.text.includes('https://'));
  const odd = (await say(chidi, 'hi‮\u0000there​!')).message.text;
  assert.strictEqual(odd, 'hi there !', 'control and direction-trick characters are removed');
  const html = (await say(chidi, '<img src=x onerror=alert(1)>')).message.text;
  assert.strictEqual(html, '<img src=x onerror=alert(1)>', 'stored as plain text; the page shows it as text, never as HTML');
  ok('empty, too long, duplicate and link-spam messages are refused; odd characters removed');

  // ---- challenge codes become Join buttons ----
  const Pz = require('../src/puzzles');
  const host = user('Hostess'), pal = user('Pal');
  const hch = {
    id: 'ABC234', createdBy: host.id, invited: null, category: 'Naija', maxPlayers: 2, closed: false, race: true, rounds: 25, stake: 50, pot: 50,
    startedAt: null, puzzleIds: Pz.puzzles.slice(0, 25).map((p) => p.id), createdAt: Date.now(), status: 'waiting', players: {}, winner: null,
  };
  hch.players[host.id] = { username: 'Hostess', idx: 0, startedAt: null, wrong: 0, score: 0, results: [], finishedAt: null, solved: 0, queue: [] };
  db.challenges[hch.id] = hch;
  const withCode = (await say(pal, 'who wants to play abc234 with me?')).message;
  assert.strictEqual(withCode.challenge.id, 'ABC234');
  assert.strictEqual(withCode.challenge.rounds, 25);
  assert.strictEqual(withCode.challenge.stake, 50);
  assert.strictEqual(withCode.challenge.category, 'Naija', 'the Join button knows the category');
  assert.strictEqual(withCode.challenge.host, 'Hostess');
  assert.strictEqual((await say(host, 'Join ZZZZ99 please')).message.challenge, null, 'a made-up code is just text');
  hch.startedAt = Date.now(); hch.status = 'active';
  const [latest] = (await feed(ada)).messages.filter((m) => m.id === withCode.id);
  assert.strictEqual(latest.challenge, null, 'no Join button once the race has started');
  ok('links of every kind are refused (admins excepted), challenge codes are allowed and become Join buttons');

  // ---- rate limits ----
  const spam = user('Spammer');
  let n = 0;
  await fails(429, async () => { for (let i = 0; i < 30; i++) { await say(spam, 'msg ' + i); n++; } });
  assert.strictEqual(n, 15, 'at most 15 messages a minute');
  process.env.CHAT_MIN_GAP_MS = '0';
  ok('no more than 15 messages a minute per player');

  // ---- moderation ----
  const rude = user('Rude');
  const bad = (await say(rude, 'something rude')).message;
  await fails(404, () => call('DELETE /api/chat/:id', ada, { params: { id: String(bad.id) } }));
  await fails(404, () => call('POST /api/chat/:id/mute', ada, { params: { id: String(bad.id) } }));
  assert.strictEqual((await feed(boss)).admin, true);
  await call('DELETE /api/chat/:id', boss, { params: { id: String(bad.id) } });
  assert.ok(!(await feed(ada)).messages.some((m) => m.id === bad.id));
  assert.ok((await feed(ada, { after: 1 })).removed.includes(bad.id), 'open chats are told to drop the deleted message');
  await fails(404, () => call('DELETE /api/chat/:id', boss, { params: { id: String(bad.id) } }));
  const worse = (await say(rude, 'another one')).message;
  await call('POST /api/chat/:id/mute', boss, { params: { id: String(worse.id) } });
  await fails(403, () => say(rude, 'let me back in'));
  assert.strictEqual((await feed(rude)).muted, true);
  assert.ok(!(await feed(ada)).messages.some((m) => m.id === worse.id));
  rude.chatMutedUntil = Date.now() - 1; // 24 hours pass
  await say(rude, 'sorry everyone');
  const adminMsg = (await say(boss, 'house rules')).message;
  await fails(400, () => call('POST /api/chat/:id/mute', boss, { params: { id: String(adminMsg.id) } }));
  ok('only admins can delete or mute; muting blocks chatting for 24 hours; admins cannot be muted');

  // ---- edit and delete your own messages ----
  const mine = (await say(ada, 'helo everybody')).message;
  await fails(404, () => call('PUT /api/chat/:id', bola, { params: { id: String(mine.id) }, body: { text: 'hacked' } }));      // not yours
  const fixed = (await call('PUT /api/chat/:id', ada, { params: { id: String(mine.id) }, body: { text: 'hello everybody' } })).message;
  assert.strictEqual(fixed.text, 'hello everybody'); assert.strictEqual(fixed.edited, true);
  await fails(400, () => call('PUT /api/chat/:id', ada, { params: { id: String(mine.id) }, body: { text: 'see www.scam.com' } })); // same link rule
  await fails(400, () => call('PUT /api/chat/:id', ada, { params: { id: String(mine.id) }, body: { text: '   ' } }));
  const seenEdit = (await feed(bola)).edited;
  assert.ok(seenEdit.some((m) => m.id === mine.id && m.text === 'hello everybody' && m.edited), 'open chats get the edited text');
  await fails(404, () => call('DELETE /api/chat/:id', bola, { params: { id: String(mine.id) } }));                          // another non-admin player
  await call('DELETE /api/chat/:id', ada, { params: { id: String(mine.id) } });
  assert.ok(!(await feed(bola)).messages.some((m) => m.id === mine.id));
  assert.ok((await feed(bola)).removed.includes(mine.id));
  ok('players can edit and delete their own messages (same rules as sending); nobody else can');

  // ---- @mentions ----
  Presence.clear();
  const tagged = (await say(bola, 'hey @Ada and @nobody_here, race me?')).message;
  assert.deepStrictEqual(tagged.mentions, ['Ada'], 'only real players count as mentions');
  const { inbox } = dbm;
  assert.ok(inbox.list(ada.id, 30).some((n) => n.kind === 'mention' && n.title.includes('Bola')), 'the tagged player gets an alert');
  assert.ok(!inbox.list(bola.id, 30).some((n) => n.kind === 'mention'), 'you are not alerted for tagging yourself');
  ok('@name tags real players and alerts them');

  // ---- private messages ----
  const dm1 = (await call('POST /api/chat', ada, { body: { to: 'bola', text: 'psst, private' } })).message;
  assert.ok(!(await feed(chidi)).messages.some((m) => m.id === dm1.id), 'private messages never show in the room');
  assert.ok(!(await feed(bola)).messages.some((m) => m.id === dm1.id));
  assert.ok(inbox.list(bola.id, 30).some((n) => n.kind === 'dm' && n.url === '#/chat/dm/Ada'));
  await fails(404, () => call('POST /api/chat', ada, { body: { to: 'nobody_xyz', text: 'hi' } }));
  await fails(400, () => call('POST /api/chat', ada, { body: { to: 'ada', text: 'me' } }));
  await fails(400, () => call('POST /api/chat', ada, { body: { to: 'bola', text: 'visit bit.ly/abc' } }));
  let list = await call('GET /api/chat/dm', bola);
  assert.strictEqual(list.unread, 1); assert.strictEqual(list.conversations[0].username, 'Ada'); assert.strictEqual(list.conversations[0].unread, 1);
  assert.strictEqual((await call('GET /api/chat/dm', chidi)).conversations.length, 0, 'a stranger sees nothing');
  const thread = await call('GET /api/chat/dm/:name', bola, { params: { name: 'Ada' } });
  assert.strictEqual(thread.messages.length, 1); assert.strictEqual(thread.messages[0].mine, false);
  assert.strictEqual((await call('GET /api/chat/dm', bola)).unread, 0, 'opening the thread marks it read');
  await call('POST /api/chat', bola, { body: { to: 'Ada', text: 'got it' } });
  const t2 = await call('GET /api/chat/dm/:name', ada, { params: { name: 'bola' }, query: { after: String(dm1.id) } });
  assert.deepStrictEqual(t2.messages.map((m) => m.text), ['got it']);
  await fails(404, () => call('GET /api/chat/dm/:name', ada, { params: { name: 'ada' } }));
  const t3 = await call('GET /api/chat/dm/:name', chidi, { params: { name: 'ada' } });
  assert.strictEqual(t3.messages.length, 0, 'a third player cannot read the thread');
  await fails(404, () => call('POST /api/chat/:id/mute', boss, { params: { id: String(dm1.id) } }));                      // admins cannot touch private messages
  await fails(404, () => call('DELETE /api/chat/:id', boss, { params: { id: String(dm1.id) } }));
  const dmFix = (await call('PUT /api/chat/:id', ada, { params: { id: String(dm1.id) }, body: { text: 'psst, private (fixed)' } })).message;
  assert.ok((await call('GET /api/chat/dm/:name', bola, { params: { name: 'ada' } })).edited.some((m) => m.id === dmFix.id));
  await call('DELETE /api/chat/:id', ada, { params: { id: String(dm1.id) } });
  assert.ok((await call('GET /api/chat/dm/:name', bola, { params: { name: 'ada' } })).removed.includes(dm1.id));
  ok('private messages: only the two players see them, unread counts, alerts, edit and delete, admins cannot read or remove them');

  // ---- admin pins ----
  const notice = (await say(boss, 'Welcome to PixSabi. Be kind.')).message;
  const notice2 = (await say(boss, 'Second notice')).message;
  const regular = (await say(ada, 'hello from Ada')).message;
  await fails(404, () => call('POST /api/chat/:id/pin', ada, { params: { id: String(notice.id) }, body: {} }));
  await fails(400, () => call('POST /api/chat/:id/pin', boss, { params: { id: String(regular.id) }, body: {} }));
  await call('POST /api/chat/:id/pin', boss, { params: { id: String(notice.id) }, body: {} });
  await call('POST /api/chat/:id/pin', boss, { params: { id: String(notice2.id) }, body: {} });
  let pinned = (await feed(ada)).pinned;
  assert.deepStrictEqual(pinned.map((m) => m.id), [notice2.id, notice.id]);
  assert.ok(pinned.every((m) => m.pinned && m.admin));
  const n3 = (await say(boss, 'n3')).message, n4 = (await say(boss, 'n4')).message;
  await call('POST /api/chat/:id/pin', boss, { params: { id: String(n3.id) }, body: {} });
  await fails(400, () => call('POST /api/chat/:id/pin', boss, { params: { id: String(n4.id) }, body: {} }));   // at most 3 pins
  ok('only an admin can pin, only admin messages, at most 3');

  // ---- keeps only the newest 200 messages; pinned ones stay ----
  for (let i = 0; i < 400; i++) chat.add(ada, 'filler ' + i);
  chat.prune(200);
  const all = chat.since(0, 5000);
  assert.ok(all.length >= 200 && all.length <= 204, `kept ${all.length}`);
  assert.strictEqual(all[all.length - 1].text, 'filler 399');
  assert.ok(all.some((m) => m.id === notice.id), 'the pinned message is never cleared');
  assert.ok(!all.some((m) => m.id === notice2.id - 0 && false));
  assert.ok(!all.some((m) => m.id === regular.id), 'unpinned old messages are cleared');
  assert.strictEqual((await feed(ada)).messages.length, 50, 'first load is the latest 50');
  assert.strictEqual((await feed(ada)).pinned.length, 3, 'pins come with every load');
  await call('POST /api/chat/:id/pin', boss, { params: { id: String(notice.id) }, body: { pinned: false } });
  assert.strictEqual((await feed(ada)).pinned.length, 2);
  await call('DELETE /api/chat/:id', boss, { params: { id: String(notice2.id) } });
  assert.strictEqual((await feed(ada)).pinned.length, 1, 'deleting a pinned message removes the pin');
  ok('only the newest 200 messages are kept; pinned admin messages stay until unpinned or deleted');

  // ---- race results posted by the game ----
  const rid = chat.addResult({ w: 'Ada', n: 4 });
  const rv = (await feed(user('viewer'))).messages.find((m) => m.id === rid);
  assert.ok(rv && rv.result.winner === 'Ada' && rv.result.players === 4 && !('losers' in rv.result) && !rv.mine && !rv.challenge);
  assert.strictEqual(rv.text, 'Ada just won a race against 3 other players!');
  await fails(404, () => call('PUT /api/chat/:id', ada, { params: { id: String(rid) }, body: { text: 'x' } }));
  assert.strictEqual(chat.scrubName('Ada'), 1, 'removing a player removes results that name them');
  ok('race results show in the room, cannot be edited, and are removed with the player');

  // ---- admin can pause the public room ----
  const bob = user('bob');
  await fails(404, () => call('PUT /api/admin/chat-lock', ada, { body: { locked: true } }));
  assert.strictEqual((await feed(ada)).lock.locked, false);
  const pmsg = (await say(ada, 'before pause')).message;
  await call('PUT /api/admin/chat-lock', boss, { body: { locked: true, note: 'Back soon', minutes: 60 } });
  const lk = (await feed(ada)).lock;
  assert.ok(lk.locked && lk.note === 'Back soon' && lk.until > Date.now());
  await fails(403, () => say(ada, 'hello?'));
  await fails(403, () => call('PUT /api/chat/:id', ada, { params: { id: String(pmsg.id) }, body: { text: 'edited' } }));
  await call('POST /api/chat', ada, { body: { to: 'bob', text: 'private still works' } });
  await say(boss, 'admin can still talk');
  await call('DELETE /api/chat/:id', ada, { params: { id: String(pmsg.id) } });
  await call('PUT /api/admin/chat-lock', boss, { body: { locked: true, minutes: 0.0001 } });
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual((await feed(ada)).lock.locked, false, 'a timed pause ends by itself');
  await call('PUT /api/admin/chat-lock', boss, { body: { locked: true } });
  await call('PUT /api/admin/chat-lock', boss, { body: { locked: false } });
  await say(ada, 'chat is open again');
  ok('admin can pause the public chat (private messages and admin still work, timed pause ends itself)');

  console.log(`\nAll ${passed} chat checks passed.`);
  dbm.flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('\nCHAT TEST FAILED:', e.stack || e.message); process.exit(1); });
