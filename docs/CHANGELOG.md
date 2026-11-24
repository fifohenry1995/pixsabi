# Naija Sabi: history of changes

This is the history of every update that was added to the game, oldest first.
IGNORE the "install" and "copy these files" steps inside each section: this
folder already contains all of them together. Use README.md to run the game.

==================================================
== Update: group
==================================================
# Group challenges (2 to 8 players)

Copy these files over your `naija-sabi` folder, replacing the old ones:

- `src/routes/challenges.js`
- `public/js/app.js`
- `package.json`
- `scripts/group-test.js` (new)

Nothing else changes, and your existing `data/db.json` keeps working. Old
challenges are treated as 2-player challenges. Then run `npm test` and `npm start`.

## How it works

- When creating a challenge, pick 2 to 8 players. The default is 2, which behaves exactly as before.
- Groups are joined with the 6-character code or the WhatsApp link. Inviting one friend by username only works for 2-player challenges.
- Everyone gets the same 5 puzzles and plays whenever they like.
- Players can join until the group is full (it closes by itself) or until the creator taps **Lock group and finish** (needs at least 2 players).
- The challenge finishes when the lobby is closed and every player has played all 5 rounds.
- Ranking: highest score first, then the lower total time. If the top players tie on both, they all get a draw.
- Stats: the winner gets a win, everyone else a loss; players tied for first get a draw.
- Scores of other players stay hidden until you finish your own rounds.

## README line to add

| Challenge | Create a challenge for 2 to 8 players and share the code (WhatsApp button included). Everyone gets the same 5 puzzles and plays whenever they like. Each puzzle is worth 100 points, minus 1 per second and 5 per wrong guess (never below 20). Highest score wins, and a tie goes to the faster player. The creator can lock the group once at least 2 people have joined. |

## Change the maximum group size

`MAX_PLAYERS` at the top of `src/routes/challenges.js` (default 8), and the list `[3, 4, 5, 6, 7, 8]` in `public/js/app.js`.

==================================================
== Update: profile
==================================================
# Player profiles: description and display picture

This update builds on the group challenges update. If you have not installed that one yet, install it first.

Copy these into your `naija-sabi` folder, keeping the same sub-folders and replacing files with the same name:

- `src/app.js`, `src/db.js` (replace)
- `src/routes/auth.js`, `challenges.js`, `leaderboard.js` (replace)
- `src/routes/profile.js` (new)
- `public/index.html`, `public/js/app.js` (replace)
- `public/css/profile.css` (new)
- `scripts/profile-test.js` (new)
- `package.json` (replace)

Do not touch `data/`. Existing players keep working and simply start with no description and no photo.

Then run `npm test` and `npm start`.

## What players get

- **Me** tab: add, change or remove a display picture, and write a description of up to 160 characters.
- Photos are cropped to a square and shrunk to 256x256 in the browser before upload, so they stay about 15 to 40 KB. Without a photo, a coloured circle with the player's first letter shows instead.
- Photos and names appear on the Ranks screen and in challenge standings. Tapping a name opens that player's profile with their description, stats and a **Challenge** button.

## Good to know

- Photos are saved as files in `data/avatars/`. Back that folder up along with `data/db.json`, and keep it on persistent storage when you host the game.
- Only logged-in players can load photos. There is no automatic moderation of photos or descriptions. If someone uploads something unsuitable, delete their file from `data/avatars/` (the game falls back to the letter circle) and clear `bio` for that user in `data/db.json` while the server is stopped.
- Add `data/avatars` to your `.gitignore` if you use git.

## README addition

Profiles: each player can add a 160-character description and a display picture on the Me tab. Photos are stored in `data/avatars/` (JPEG, 256x256).

==================================================
== Update: picture
==================================================
# Answer protection + one collage picture per puzzle

Replace the earlier "picture update". This one includes it and fixes a leak.

## The problem this fixes

1. Picture files were named after the answer and served from `/images/jollof.jpg`, so a
   player could read the answer from the address.
2. Separately, the puzzle id the server sent to the browser was the answer itself
   (for example `abuja`), so it showed in the network tab even without pictures.

Both are fixed. Players now only get a random id (like `3f9a1c07d2b4e815`), and the
picture comes from `/pic/<random id>` for logged-in players only.

## Install

Copy these into your `naija-sabi` folder, keeping the same sub-folders and replacing files with the same name:

- `src/puzzles.js`, `src/app.js` (replace)
- `src/routes/solo.js` (replace)
- `public/index.html`, `public/css/collage.css` (new), `public/js/game.js` (replace)
- `scripts/` (replace everything inside, including the new `check-images.js` and `image-test.js`)
- `package.json`, `README.md` (replace)

Do not touch `data/`. Players' progress is not affected, because the real ids are
still used inside the database. Only what the browser sees has changed.

## Move your pictures

1. Create the folder `content/images/` inside `naija-sabi`.
2. Move all your collage pictures into it (from `public/images` if you put them there).
3. Name each one after its answer in small letters (`jollof.jpg`).
4. Run `npm run images` to see what is still missing, then `npm test` and `npm start`.

Anything left in `public/images` still works, but that folder is never served to players.

## Requirements

- Your server must run this code. A player who already has the old page open must refresh it.
- If you host online, upload `content/images/` too.

==================================================
== Update: ui
==================================================
# New look: night violet and gold

Matches the mockup: deep violet background, gold trim, a glowing frame around the puzzle
picture, letters in two rows (violet over gold), round hint buttons with the coin cost,
and a race header with player photos in challenges. A thin green-white-green stripe under
the top bar is a small nod to the flag.

## Install

This builds on the earlier updates (group challenges, profiles, one picture per puzzle,
answer protection). Install those first if you have not.

Copy these into your `naija-sabi` folder, keeping the same sub-folders and replacing files with the same name:

- `public/css/style.css`
- `public/js/app.js`
- `public/js/game.js`
- `public/index.html`

Nothing else changes: no server files, no data. Then refresh the page (Ctrl+Shift+R, or clear the cache on your phone).

You can delete `public/css/profile.css` and `public/css/collage.css`. Their styles are now inside `style.css` and `index.html` no longer loads them.

## What changed on screen

- **Challenge screen:** "ROUND 2/5" pill and a race strip with your photo and your opponent's photo.
  Groups show a row of everyone's photos. Scores stay hidden until you finish, because friends play
  at different times, so the strip shows how far along each player is.
- **Letters:** first row violet, second row gold. New **Shuffle** button (free) mixes the letters.
- **Hints:** Reveal and Clue show their coin cost on the button. Costs are unchanged (15 and 5 coins),
  not the 100 / 50 / 50 in the mockup. Skip sits in the same row.
- **Picture:** sized to the screen so the letters stay in view on a phone. The whole collage always shows.
- Result popups now close if you move to another screen.

## Change the colours

All colours are at the top of `public/css/style.css` (the `:root` block). For example `--gold` is the gold trim and `--violet` is the letter tiles.

==================================================
== Update: solo-fix
==================================================
# Fix: Play kept swapping the puzzle

Before, every time you opened the Play tab (after visiting Me, Ranks, Daily or Challenge, or after a
refresh) the server picked a new random puzzle. Now it remembers your current puzzle until you solve
it or skip it.

- Leaving the Play screen and coming back shows the same puzzle, with any letters or clue you paid for.
- Choosing a category remembers a puzzle for that category too, so switching back does not lose your place.
- **Skip** gives you a different puzzle. Solving a puzzle brings up the next one.

## Install

Copy these two files into your `naija-sabi` folder, keeping the same sub-folders and replacing the old ones:

- `src/routes/solo.js`
- `scripts/smoke-test.js` (adds a test for this)

Then stop the server (Ctrl+C) and run `npm test` and `npm start`. Players do not need to do anything,
and `data/` is not touched. This only changes server code, so there is nothing to clear in the browser.

This builds on the earlier updates (it needs the answer-protection version of the game).

==================================================
== Update: level
==================================================
LEVELS UPDATE

Replaces the "x of y solved" counter with a Level number.
Level = puzzles you have solved + 1, so it goes up by 1 each time you solve one.
Shown on the Play screen, your profile and other players profiles.

Install: copy public/js/app.js into your naija-sabi/public/js/ folder and replace the old one.
No restart needed; just refresh the browser (Ctrl+F5).

==================================================
== Update: admin
==================================================
# Admin page + installable app (version 1.5.0)

## 1. Install (copy over, do NOT delete anything, do NOT touch `data/`)
1. Unzip. Copy everything inside `naija-sabi-admin-update` into your `naija-sabi` folder. Say **Replace / Merge** when asked.
   - `content/admin.txt` is new. Your `content/puzzles.json` and `content/images` are NOT in this zip, so they stay as they are.
2. Open `naija-sabi/content/admin.txt` in Notepad. Replace the example with YOUR username (the one you log in with) and remove the `#` in front of it. Save.
3. Stop the game (Ctrl+C), run `npm test`, then `npm start`.
4. Log in to the game as that user, open **Me** and tap **Admin: manage puzzles** (or go to `/admin.html`, for example http://localhost:3000/admin.html).

## 2. Using the admin page
- **Add puzzle**: type the answer (3 to 12 letters), category, clue, fun fact and choose your collage picture. The picture is shrunk automatically and saved as `content/images/<answer>.jpg`.
- **Edit**: change anything. If you change the ANSWER, players who solved it keep their credit and the picture file is renamed for you.
- **Delete**: the puzzle goes, the picture file stays in `content/images`.
- Changes are live at once. No restart.
- Before every change a dated copy of `content/puzzles.json` is saved in `content/backups/` (newest 30 kept). To undo, copy a backup over `puzzles.json` and restart.
- Only the usernames in `content/admin.txt` can open it (or set `ADMIN_USER`). Everyone else gets "Not found".
- Good to know: the Daily puzzle is picked from the list by date, so adding or deleting puzzles can change which puzzle is today's Daily.

## 3. Installable app (PWA)
- Players see an **Install** bar (Android / Chrome / Edge). On iPhone Safari: Share > Add to Home Screen.
- It opens full screen with the purple "NS" icon. With no internet it shows a friendly "No network" page.
- Puzzle pictures, answers, profile photos and the admin page are never saved on the phone.
- IMPORTANT: browsers only allow installing from **https** websites (or localhost on the same computer). Testing on your PC at http://localhost:3000 works. For players' phones, host the game on an https address.

## Files
New: src/routes/admin.js, public/admin.html, public/js/admin.js, public/css/admin.css, public/sw.js, public/manifest.webmanifest, public/offline.html, public/js/pwa.js, public/js/offline.js, public/css/pwa.css, public/icons/*, scripts/admin-test.js, content/admin.txt
Changed: src/puzzles.js (live reload), src/app.js, src/routes/challenges.js (safe when a puzzle was removed), public/index.html, public/js/app.js (Admin link), package.json

==================================================
== Update: layout
==================================================
# Small phones, short screens and adverts (version 1.6.0)

Needs the previous "admin + installable app" update already installed.

## Install (copy over, do NOT delete anything, do NOT touch `data/` or `content/`)
1. Unzip. Copy everything inside `naija-sabi-layout-update` into your `naija-sabi` folder. Choose Merge / Replace.
2. Stop the game (Ctrl+C), run `npm test`, then `npm start`.
3. In the browser press Ctrl+F5 once (phones: close and reopen the page). The installed app updates itself on the next open.

## What changed
- Small phones and short screens: the picture, answer boxes, letters and hint buttons now fit on one screen without scrolling (tested from 320x568 phones up to 1920x1080 screens). Category picker and Level badge share one row.
- Laptops and big screens (1100 px wide and up): two advert pictures appear on the LEFT of the game. Phones and tablets never show them. If no advert is set, nothing shows.
- Admin page > "Adverts" section at the top: for each of the two slots choose a picture (cropped to a square automatically, about 600 x 600 is best), add an optional link (opens in a new tab) and a short description, then press Save advert. Remove clears it. Changes show to players straight away.
- Advert pictures are saved in `content/ads/` (new folder, created for you).

## Files
New: src/ads.js, public/js/ads.js, public/css/ads.css
Changed: src/app.js, src/routes/admin.js, public/css/style.css, public/css/admin.css, public/js/admin.js, public/js/app.js, public/index.html, public/sw.js, scripts/admin-test.js, package.json

==================================================
== Update: popup
==================================================
# Pop-up adverts: picture, GIF or video (version 1.7.0)

Needs the earlier updates installed (admin page, layout/adverts).

## Install (copy over, do NOT delete anything, do NOT touch `data/` or `content/`)
1. Unzip. Copy everything inside `naija-sabi-popup-update` into your `naija-sabi` folder. Choose Merge / Replace.
2. Stop the game (Ctrl+C), run `npm test`, then `npm start`.
3. Press Ctrl+F5 once in the browser (phones: close and reopen the page).

## How it works
- After a player finishes every 10th level in SOLO play (levels 10, 20, 30 ...) and taps "Next puzzle", an advert pops up.
- Never in challenges, races or the Daily puzzle.
- Adverts take turns in the order you set. The Close button appears after a few seconds (you choose how many). Players can then close it, or tap "Learn more" if you gave it a link.
- If a file cannot load, the pop-up is skipped quietly and the game carries on.

## Admin page > "Pop-up adverts" (open /admin.html or Me > Admin)
- Show pop-up adverts: on/off switch.
- Show one after every ... levels: default 10 (any number from 1 to 100).
- Close button appears after ... seconds: 0 to 15.
- Add an advert: choose a picture (JPG or PNG, shrunk for you), a GIF (up to 2.5 MB) or a video (MP4 or WEBM, up to 4 MB, about 15 seconds). Add an optional title and link.
- Each advert can be switched Active/inactive, edited or deleted. Up to 10 adverts.
- Files are saved in `content/popups/` (new folder, created for you).

## Tips
- Videos play muted (phones do not allow sound to start by itself). A "Sound off" button lets players turn sound on.
- Keep videos short and small. Many players pay for mobile data.
- Use MP4 (H.264) for the widest phone support.

## Files
New: src/popups.js, public/js/popup.js, public/css/popup.css
Changed: src/app.js, src/routes/admin.js, public/js/admin.js, public/js/app.js, public/css/admin.css, public/index.html, public/sw.js, scripts/admin-test.js, package.json



==================================================
== Update: SQLite database (v1.8.0)
==================================================
# Real database: SQLite

- `src/db.js` now stores players and challenges in `data/naija-sabi.db` using Node's built-in `node:sqlite` (Node 22.13 or newer, still nothing to npm install).
- The old file database rewrote EVERYTHING on each save (about 0.9 s of freezing at 50,000 players). Now only the changed player is written (about 0.1 ms).
- Leaderboard, your rank, friend search, "my challenges", the 10-open-challenge limit and the admin "solved by" counts are SQL queries with indexes instead of scanning every player.
- An existing `data/db.json` is imported automatically once and kept as `db.json.imported-<time>`.
- New: `npm run backup` (safe copy of the database), `scripts/db-test.js` (import, restart, ranking, tiny-cache safety).
- Measured with 50,000 players + 100,000 challenges: save 0.1 ms, top 25 0.14 ms, rank 0.6 ms, search 0.06 ms, memory 112 MB (was 540 MB).


==================================================
== Update: six adverts and a bigger puzzle (v1.8.1)
==================================================
- Adverts: six slots, three on the left (1 to 3) and three on the right (4 to 6). The admin page has a Left side and a Right side section. Pictures are as big as the screen allows (up to 340 px; about 295 px on a full-HD screen) and grow when fewer are used.
- Bigger puzzle: the game column is 600 px wide (was 520), and the picture / emoji block is bigger on tablets and laptops (up to 38% of the screen height) and a little bigger on phones, checked so the letters and hint buttons never go under the bottom bar.


==================================================
== Update: skip penalty in challenges (v1.8.2)
==================================================
- Skipping a puzzle in a challenge now takes off 10 points (it was 0). The score in that challenge can go below zero, but a player's overall points never go down because of a challenge.
- Winner rule unchanged: the highest score wins, and a tie goes to the faster player.


==================================================
== Update: solo skip costs coins (v1.8.3)
==================================================
- Solo Skip now costs 20 coins (Reveal 15, Clue 5, Shuffle free). With fewer than 20 coins the player is told to solve a puzzle first (+10 coins each).
- The server now picks the next puzzle when a player pays to skip (new POST /api/solo/skip). The old free "?skip=" shortcut on /api/solo/next is gone, so skipping cannot be done for free.


==================================================
== Update: buy coins with Paystack (v1.9.0)
==================================================
- New Buy coins button: a "+" next to the coin count, a card on the Me page, and it also opens when a player is out of coins for a hint or skip.
- Three packs (200 coins N500, 600 coins N1,200, 1,500 coins N2,500). Change them in `PACKS` at the top of `src/routes/coins.js`.
- Payments go through Paystack. Coins are only added after the server asks Paystack and gets "success" for the right amount, once per payment (webhook and return page can both arrive safely). The webhook signature (HMAC SHA512) is checked.
- New `orders` table in the database, `npm run orders` to list purchases, `scripts/pay-test.js` (fake Paystack, 8 checks).
- Needs `PAYSTACK_SECRET_KEY` and `PUBLIC_URL`. Without a key the button politely says it is not open yet.


==================================================
== Update: zoom the puzzle picture (v1.9.1)
==================================================
- Tap the puzzle picture to open it full screen and zoom up to 5 times: pinch, double-tap, mouse wheel, or the + and - buttons. Drag to move around, tap outside the picture, press Esc, or tap the X to close.
- Changed files: public/js/game.js, public/css/style.css. No server changes.

==================================================
== Update: level races (v2.0.0)
==================================================
UPDATE 16: LEVEL RACES (v2.0.0)

WHAT CHANGED
- Challenges are now races. The person who creates one picks the number of levels: 20 or more, up to the number of puzzles in the game (type any number, or tap 20 / 50 / 100). The old 5-puzzle challenge is gone for new challenges.
- Works for 2 players and for groups of up to 8.
- Everyone joins a lobby (by code or WhatsApp link). The host taps "Start race" once at least 2 players are in. Nobody can play before that, and nobody can join after it.
- Everyone plays the same levels at the same time. The FIRST player to finish ALL the levels wins and the race ends immediately for everyone. The others are ranked by how many levels they cleared.
- Skip costs 10 points and the skipped level comes back at the end of your list, so nobody can win by skipping. A wrong guess only costs time and a few points.
- No hints in races. Progress ("12 of 50") for every player updates live above the puzzle.
- If a chosen category has fewer puzzles than the levels, the rest are filled with puzzles from other categories.
- Admin: you can no longer delete puzzles below 20 in total (races need 20).
- Challenges that were already running (5 puzzles, highest score wins) still work the old way.

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  src/routes/challenges.js  src/routes/admin.js
  public/js/app.js  public/css/style.css  public/sw.js
  scripts/group-test.js  scripts/smoke-test.js  scripts/admin-test.js
  package.json  README.md  docs/CHANGELOG.md  docs/UPDATE-16-LEVEL-RACES.txt

Then restart the server (Ctrl+C, then npm start). No database change is needed.
Then press Ctrl+F5 once in the browser (phones: close and reopen the page).
Run npm test if you like: all checks pass.

TIP: a 100-level race uses almost all of your 104 puzzles. Add more puzzles from the Admin page for bigger races.

==================================================
== Update: coin stakes (v2.1.0)
==================================================
UPDATE 17: COIN STAKES IN RACES (v2.1.0)

WHAT CHANGED
- When creating a race the host can set a coin stake: none, 10, 20, 50, 100, 200 or 500 coins each (the server accepts any whole number from 0 to 1000).
- Every player pays the stake when they join (the host pays when creating the race). The coins go into the race's pot.
- The first player to finish all the levels wins the WHOLE pot, added to their coins straight away.
- Before paying, a player sees a confirmation page: levels, stake, pot so far and their balance. Nothing is charged until they tap "Join and stake N coins". If they do not have enough coins, they are offered to buy coins and are not added to the race.
- Refunds: the host can "Cancel race and refund" and any other player can "Leave and get my coins back", both only before the race starts. A staked race that nobody starts within 24 hours is cancelled and refunded automatically (checked every hour and whenever someone opens the challenge list).
- Once the race has started there are no refunds. Coins are never created or lost: the pot paid out equals the stakes paid in.
- Cancelled races show as "Cancelled, refunded" in the challenge list. A cancelled race can never be started. Puzzles used only by cancelled races can be deleted in Admin again.
- Rematch keeps the same levels and stake. The invite message (WhatsApp / copy) mentions the stake.
- Races without a stake work exactly as before and never touch coins.

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  src/db.js  src/routes/challenges.js  src/routes/admin.js
  public/js/app.js  public/sw.js
  scripts/group-test.js
  package.json  README.md  docs/CHANGELOG.md  docs/UPDATE-17-COIN-STAKES.txt

Then restart the server (Ctrl+C, then npm start). No database change is needed.
Then press Ctrl+F5 once in the browser (phones: close and reopen the page).
Run npm test if you like: all checks pass.

IMPORTANT BEFORE YOU GO PUBLIC: players can buy coins with real money (Paystack) and a stake moves those coins to the winner. Coins cannot be cashed out, which keeps this a game, but staking can still be treated as betting or gaming under Nigerian rules. Get a quick legal opinion before you advertise it, and do not add a cash-out feature without one.

==================================================
== Update: chat room and live counts (v2.2.0)
==================================================
UPDATE 18: CHAT ROOM AND LIVE PLAYER COUNTS (v2.2.0)

WHAT CHANGED
- New "Chat" tab (bottom bar): one chat room for every player. Messages show the player's photo and name (tap the name to see their profile) and the time. New messages appear by themselves every few seconds.
- Live counts: a strip under the top bar on every page shows "players" (everyone registered) and "online" (players seen in the last 2.5 minutes). The login screen shows the same numbers. Online status is kept in memory only, so it needs no database space.
- Chat rules (built in): plain text only (never shown as HTML, so nobody can inject code), up to 300 letters, no more than 15 messages a minute and 1.5 seconds between messages, the same message twice in a minute is refused, no more than 2 links per message, hidden/control characters are removed. Only the newest 1000 messages are kept.
- Moderation: admins (the names in content/admin.txt or ADMIN_USER) see "Delete" and "Mute 24h" next to other people's messages. Muting deletes that message and stops that player chatting for 24 hours; admins cannot be muted. Deleted messages disappear from other players' open chat within seconds.
- New database table "chat" is created automatically on the first start. Nothing to migrate.

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  src/presence.js (new)  src/routes/chat.js (new)  src/db.js  src/app.js  src/routes/admin.js
  public/js/app.js  public/css/style.css  public/sw.js
  scripts/chat-test.js (new)  package.json  README.md  docs/CHANGELOG.md  docs/UPDATE-18-CHAT-AND-LIVE-COUNTS.txt

Then restart the server (Ctrl+C, then npm start).
Then press Ctrl+F5 once in the browser (phones: close and reopen the page).
Run npm test if you like: all checks pass.

GOOD TO KNOW
- The chat checks for new messages every 3 seconds only while someone has the Chat tab open and the page is visible. Every open game also sends one tiny "I am here" ping a minute, which is what "online" counts.
- If your game is public, people can write anything. Keep an eye on the chat the first days, and tell me if you want a word filter, a report button, or "only players with 10+ solved puzzles can chat".
- Behind a proxy or host that limits requests per IP, many players on one network share the 300 requests/minute limit in src/app.js. Raise it if a school or office plays together.

==================================================
== Update: profiles from chat (v2.2.1)
==================================================
UPDATE 19: PLAYER PROFILES FROM CHAT (v2.2.1)

- In the chat room, tap a player's NAME or PHOTO to open their profile: photo, description, rank, level, best streak and challenge record, plus a "Challenge" button.
- The profile now shows "Online now" when that player is online.
- The profile's last button says "Back to chat" when you came from the chat (otherwise "Back to ranks"), and the Chat tab stays highlighted.

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  src/routes/profile.js  public/js/app.js  public/css/style.css  public/sw.js
  package.json  docs/CHANGELOG.md  docs/UPDATE-19-PROFILES-FROM-CHAT.txt

Then restart the server and press Ctrl+F5 in the browser (phones: close and reopen the page).

==================================================
== Update: no links in chat (v2.2.2)
==================================================
UPDATE 20: NO LINKS IN CHAT, CHALLENGE CODES ONLY (v2.2.2)

- The chat now refuses every kind of link, so nobody can post spam or scam links: http/https, www, "site.com", "site(.)com", "site dot com", emails, t.me / wa.me / bit.ly and WhatsApp group invites. The player sees: "Links are not allowed in chat. You can share a challenge code instead."
- Ordinary sentences are not affected ("I scored 3.5", "ok. net worth...", "jollof rice is life.").
- Challenge codes ARE allowed. When a message contains the code of a real race that can still be joined, the chat shows a "Join race ABC234: 30 levels, 20 coin stake (1/2)" button under it. Tapping it opens the normal join page (which shows the stake before charging anything). Made-up codes and races that already started or are full get no button.
- Admins (content/admin.txt or ADMIN_USER) can still post links, for announcements.
- Tip for players: when sharing a race in the chat, paste only the code. The "Copy invite" text contains a web address, so it is for WhatsApp, not for the chat.

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  src/routes/chat.js  public/js/app.js  public/css/style.css  public/sw.js
  scripts/chat-test.js  package.json  docs/CHANGELOG.md  docs/UPDATE-20-NO-LINKS-IN-CHAT.txt

Then restart the server and press Ctrl+F5 in the browser (phones: close and reopen the page).

==================================================
== Update: updates show up right away (v2.2.3)
==================================================
UPDATE 21: UPDATES SHOW UP RIGHT AWAY (v2.2.3)  (fixes "the Chat tab is not showing")

THE PROBLEM
The server told browsers to keep the game's scripts and styles for 1 hour. So after an update, a browser or phone that had already opened the game could keep running the OLD app.js and never show new things such as the Chat tab, until the hour passed or the page was force-refreshed.

THE FIX
- Scripts, styles, pages and the manifest are now re-checked with the server on every load. If nothing changed, the server answers with a tiny "304 not modified" (ETag), so the game still loads fast.
- The service worker (the installed-app helper) also asks the server before using its saved copy.
- Pictures and icons are still kept for an hour.
After this update is installed, future updates reach everyone as soon as they open or refresh the game.

THIS ZIP ALSO CONTAINS EVERY CHAT FILE, so it works even if an earlier zip was only partly copied. It is safe to copy over version 2.1.0 or any later version.

IF THE CHAT TAB STILL DOES NOT SHOW (checklist)
1. The server must be restarted after copying files: press Ctrl+C in the terminal, then run: npm start. (An old server keeps running the old code.)
2. The terminal must show no red error on start. A message like "Cannot find module './presence'" means src/presence.js was not copied.
3. Open the game, then press Ctrl+F5 (computer) or close and reopen the page / the installed app (phone). Do this once.
4. The bottom bar should now show 6 tabs: Play, Daily, Challenge, Chat, Ranks, Me, and a strip "players / online" under the top bar.
5. Still nothing? Open  your-site/js/app.js  in the browser and search for "#/chat". If it is missing, the old file is still on the server.

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  src/presence.js (new)  src/routes/chat.js (new)  src/db.js  src/app.js  src/routes/admin.js  src/routes/profile.js
  public/js/app.js  public/css/style.css  public/sw.js
  scripts/chat-test.js (new)  scripts/smoke-test.js  scripts/group-test.js
  package.json  README.md  docs/CHANGELOG.md  docs/UPDATE-21-UPDATES-SHOW-UP-RIGHT-AWAY.txt

==================================================
== Update: category before joining (v2.3.0)
==================================================
UPDATE 22: SEE THE CATEGORY BEFORE JOINING A RACE (v2.3.0)

- Every race now shows a "Join this race?" page BEFORE a player is added. It lists: Category, Levels, Players joined (for example 1 of 2), and Stake (or "None, just for fun"). The player taps "Join race" (or "Join and stake N coins") only if they like it, or "No thanks".
  Before this update only staked races asked first.
- The category also shows:
  - in the lobby (host and everyone waiting): "Category: Food"
  - on the Join button the chat makes from a challenge code: "Join race ABC234: Food, 30 levels, 20 coin stake (1/2)"
  - in "Your challenges": "Race, 20 levels, Food"
  - in the invite text for WhatsApp / Copy invite: "...Category: Food."
- "Mix of everything" is shown when the host did not pick a category.
- If a category does not have enough puzzles, the page says so honestly: "Food (12 of 20 levels, the rest mixed)".
- Nothing about the answers is revealed: only the category name and counts.

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  src/routes/challenges.js  src/routes/chat.js
  public/js/app.js  public/css/style.css  public/sw.js
  scripts/group-test.js  scripts/chat-test.js
  package.json  docs/CHANGELOG.md  docs/UPDATE-22-CATEGORY-BEFORE-JOINING.txt

Then restart the server and refresh the browser (updates now show up by themselves; phones: close and reopen once).

==================================================
== Update: new login screen (v2.4.0)
==================================================
UPDATE 23: NEW LOGIN SCREEN (v2.4.0)

WHAT CHANGED
- New login / create-account screen, a blend of the two designs you liked (B and C):
  * a green hero with a Naija pattern, the big headline "YOU THINK SAY / YOU SABI?", the line "Look. Think. Answer." and your category names as chips (they follow your puzzle categories automatically);
  * a dark glass login sheet with a pill switch (Log in / Create account), icon fields and a gold button ("Log in" or "Create account and play");
  * the green-white-green flag stripe along the bottom, and "players / online" counts under the sheet.
- On laptops (900 px wide and up) the hero sits on the left and the login sheet on the right. On phones they stack, and it fits a 360 x 640 phone without scrolling.
- The login page has no adverts and uses the full width. Adverts come back after login, as before.
- Wording: the game no longer says "four pictures" because puzzles can ask questions about the picture. Updated in the login page, the page description shown in search/sharing, the WhatsApp invite text, the screen-reader labels of the puzzle picture, the README and package description. The invite now says "Look, think, answer".
- The public /api/stats now also returns the category names (used for the chips).
- Login still works exactly as before (same fields, same checks, same errors).

COPY THESE FILES over your naija-sabi folder (replace the old ones):
  public/js/app.js  public/js/game.js  public/css/style.css  public/index.html  public/sw.js
  src/routes/chat.js  scripts/chat-test.js
  package.json  README.md  docs/CHANGELOG.md  docs/UPDATE-23-NEW-LOGIN-SCREEN.txt

Then restart the server and refresh the browser.

NOT CHANGED
- Puzzle questions: puzzles are still one collage picture with a word to spell. If you want a question shown above the picture (set from the Admin page), that is a separate update.
- The admin page still says "the four pictures already joined into one" when you upload a collage. That is only an instruction to you, and is still true for collage puzzles.

## 2.5.0
- Login screen: optional blurred, sliding background pictures set from the Admin page (up to 8).

## 2.6.0
- Alerts: bell, banners, Alerts page and optional phone/browser push notifications for challenges, race start and race result.

## 2.7.0
- Two categories only: Naija and Universal, with a switch on the Play page, separate levels for each, races inside one category, and an admin Category choice.

## 2.8.0
- Sound effects on all buttons and key moments, with an on/off switch on the Me page.

## 2.9.0
- Rank titles, photo frames and badges; weekly leaderboard with coin prizes for the top 3; Naija and Universal leaderboards.

## 2.10.0
- 18+ tick and email at sign-up; forgot-password by emailed link; admin "Help a player" temporary password; Me page email/password cards; About, Privacy and Disclaimer pages (drafts, filled from content/site.json).

## 2.10.1
- Fixed the word "null" showing on a player profile when the player has no badges yet.

## 2.11.0
- New Home screen (streak week, level map, big Play button), treasure chest every 10th level (+25 coins), new level-complete popup with WhatsApp share, podium on the Ranks page.

## 2.11.1
- Added a coin icon to the coins reward on the level-complete popup, the chest message and the home map note.

## 2.11.2
- The coin emoji (shown as an empty box on some devices) is replaced by a drawn coin icon in the header, hint buttons and Buy coins packs; other messages now say "coins" in words.

## 2.12.0
- Invite a friend (link, 50 coins each when the friend solves a level, up to 20 friends), admin announcements (page, home card, optional chat post and alert to everyone), ADMIN tag in chat and announcements.

## 2.12.1
- Ready for Railway: start script seeds a persistent volume once (scripts/seed-volume.js), .node-version file, docs/DEPLOY-RAILWAY.md.

## 2.15.0

Ranks: Naija, Universal and Word Search tabs (Word Search has its own points), live refresh and once-a-day "passed you" alerts, weekly prizes card. Admin page sections fold away. See docs/UPDATE-38.

## 2.14.0

Word Search races: pick Word Search as the race category. Same word searches for everyone, first to finish them all wins the pot, no hints or skipping. See docs/UPDATE-37.

## 2.13.0

New game mode: Word Search (find the hidden words in a letter grid). Third tab on the home and play screens, hints, levels, chests, points toward ranks, and an admin section to add word lists. See docs/UPDATE-36.

## 2.12.3

Race timeout: a started race with no finisher ends after 3 days (most levels wins the pot, a tie refunds everyone); free lobbies nobody starts close after 2 days. See docs/UPDATE-35.

## 2.12.2
- Delete a puzzle now has an option to also remove its picture file; players who have the deleted puzzle open get a fresh one automatically.

==================================================
== Update: race timeout (v2.12.3)
==================================================
UPDATE 35 (v2.12.3): races can no longer get stuck

WHAT CHANGED (checked every hour and when the server starts)
- A race that STARTED and has no finisher after 3 days is ended automatically.
  The player who cleared the most levels wins the whole pot (ties on levels are broken by points).
  If the top spot is still shared, or nobody cleared a single level, every player gets their stake back.
  Everyone in the race gets an alert saying what happened.
- A staked race nobody started within 24 hours: everyone refunded (as before, now with an alert).
- A FREE race lobby nobody started within 2 days is closed, so it stops counting toward a player's limit of 10 open challenges.
- The rules text (how-it-works card, create-race screen, race page) now mentions the 3-day limit.

Files: src/routes/challenges.js, src/db.js, public/js/app.js, scripts/group-test.js (new checks), public/sw.js (cache v24).
To change the limits, edit ABANDON_MS, STALE_MS and LOBBY_MS at the top of src/routes/challenges.js.

==================================================
== Update: word search (v2.13.0)
==================================================
UPDATE 36 (v2.13.0): WORD SEARCH, a new game mode

WHAT PLAYERS SEE
- A third tab "Word Search" next to Naija and Universal on the home screen and the play screen.
- Home shows a Word Search card (theme, number of words, a peek at the grid) and a big Play button.
- The puzzle: a grid of letters and a list of words underneath. The player drags a finger over a word to find it. Found words
  turn colour and are struck off the list. Words run across and down at first; slanted words come from level 7; backwards words from level 25.
  The grid grows from 8x8 to 12x12 as levels go up. Leaving the screen keeps what the player found.
- Hints: "Mark a first letter" (15 coins) rings the first letter of one word. "Reveal a word" (30 coins) finds one word.
- Finishing a level: points (20 per word, minus 10 per first-letter hint and 20 per revealed word, never below 40% of the full score),
  +10 coins, a treasure chest with +25 coins on every 10th word search, a fun fact if you wrote one, and a WhatsApp share button.
- Word Search points count toward the player's total points, the Naija points and the weekly ranks (so it feeds the Ranks page).

WHAT YOU DO (admin page, new "Word Search" section)
- Type a theme and the words to find (separated by spaces or commas, letters only, 3 to 12 letters each, 4 to 14 words) and tap
  "Add word search". The game makes the letter grid itself. New ones go to the END of the list and are live straight away.
- Edit changes the theme or words. Delete removes one: players on it move to the next one, and the levels after it shift up by one.
- 31 starter word searches are included (content/wordsearch.json).

RAILWAY: add one more variable: WORDSEARCH_FILE = /data/content/wordsearch.json (the first start copies the 31 starters there once;
after that the admin page edits that copy). Locally nothing needs to be set.

Notes
- Players are never stuck: if the admin deletes the level a player is on, the game says "The admin just updated the word search"
  and loads the next one.
- Word Search is not part of races or the daily puzzle. There is no skip button: a level can only be finished, or deleted by you.
- Dragging works with a finger or a mouse. Screen readers cannot play it yet.

Files: src/wordsearch.js (grid maker), src/routes/wordsearch.js, src/routes/admin.js, src/app.js, src/db.js unchanged, public/js/app.js,
public/js/admin.js, public/css/style.css, public/sw.js (cache v25), scripts/seed-volume.js, scripts/wordsearch-test.js (7 checks),
content/wordsearch.json, docs/DEPLOY-RAILWAY.md.

==================================================
== Update: word search races (v2.14.0)
==================================================
UPDATE 37 (v2.14.0): WORD SEARCH RACES

WHAT PLAYERS SEE
- On the "Challenge your friends" screen the Category list has a new choice: Word Search.
- Choosing it changes the length box to "How many word searches? (3 to 31)" with quick buttons 5, 10 and 20 (default 5), because one word search
  takes a minute or two. Players (2 to 8), coin stake, friend name and the share code work exactly like the other races.
- Everybody in the race gets the SAME word searches in the same order (a random pick from your list, easiest first).
  Each player finds the words by dragging over them. Finishing one opens the next. The first player to finish ALL of them wins the whole pot.
- The race strip on top shows how many each player has finished, live.
- No hints and no skipping in a word search race (so coins cannot buy a win).
- Points: 20 per word found, added to each player's points when the race ends, like other races.
- The 3-day limit works the same: the player with the most word searches finished wins the pot, a tie refunds everyone.
- The Rematch button on the results page repeats a word search race.

If you delete a word search on the admin page while a race is using it, the race simply counts that one as done for everybody (nobody gets stuck).

Files: src/routes/challenges.js, public/js/app.js, public/sw.js (cache v26), scripts/wordsearch-test.js (now 10 checks), README.md, docs.

==================================================
== Update: ranks and admin folding (v2.15.0)
==================================================
UPDATE 38 (v2.15.0): Ranks has Naija, Universal and Word Search; "X passed you" alerts; admin sections fold away

RANKS PAGE
- The tabs are now just Naija, Universal and Word Search (the Overall and This week tabs are gone). Each tab ranks players by the
  points they earned in that game. Word Search now has its OWN points: solo word searches and word search races add to it,
  and they no longer add to the Naija board. Points still add to a player's total (rank title, photo frame, badges) and to the weekly points.
- Points players already earned in solo word searches before this update are moved from the Naija board to the Word Search board once, automatically.
- The weekly prizes are NOT removed: they still run (top 3 of the week win 200, 100 and 50 coins, points from every game count).
  They now show as a "Weekly prizes" card under each board, with the top 3 this week, the player's own weekly rank and the countdown.
- The page refreshes by itself every 20 seconds while it is open, so when somebody passes another player the list changes
  without anyone reloading.
- When a player passes other players on a board, those players get an alert ("Tunde passed you in Naija ranks. Play to take your place back!")
  in the bell and as a phone notification if they switched that on. To avoid spamming, a player gets at most ONE such alert per board per day,
  at most 5 players are alerted for one jump, and a player's very first points alert nobody.

ADMIN PAGE
- Every section (Announcements, Word Search, Help a player, Adverts, Login screen background, Pop-up adverts, Puzzles) is now a folding header.
  Tap a header to open or close it. "Open all" and "Close all" are at the top. Sections start closed; what you leave open is remembered on that device.

Files: src/db.js (new pts_ws column, added automatically), src/points.js, src/routes/leaderboard.js, src/routes/wordsearch.js,
public/js/app.js, public/js/admin.js, public/css/style.css, public/css/admin.css, public/sw.js (cache v27), scripts/ranks-test.js (10 checks).

==================================================
== Update: game picker (v2.16.0)
==================================================
UPDATE 39 (v2.16.0): swipe between Naija, Universal and Word Search on the home screen; photo backgrounds from the admin page

HOME SCREEN
- Under the welcome line there are now three big game cards (Naija, Universal, Word Search) in a row. Swipe sideways to move between them;
  the next card peeks in from the side. Each card shows a background scene, the player's level, a progress bar and a big Play button.
- The cards slide by themselves, slowly: 3 seconds after the player stops touching the screen, the next card glides in over about 1.5 seconds
  (and after the last card it goes back to the first). The moment a player touches or scrolls the cards, the auto-slide waits 8 seconds.
  It never slides for players who have "reduce motion" switched on in their phone, or while the page is hidden.
- The card in the middle is the chosen game: the level map and chest counter below it change to match, and the Play button opens that game.
  The old Naija / Universal / Word Search tab row is gone from the home screen (the Play screen and the other screens keep their tabs).
- The old separate "Play level N" button is now inside each card.

BACKGROUND PHOTOS (admin page)
- New folding section "Game card photos" with one slot per game. Upload a photo and it replaces the drawn scene on that card; "Use the drawn scene"
  brings the drawing back. Tall or square photos (about 1000 pixels) work best. Saved straight away.
- The three drawn scenes: Naija (danfo bus, Lagos skyline, green-white flags), Universal (globe and orbit), Word Search (letter tiles, LAGOS, magnifier).

ON RAILWAY
- Add the variable WORLDBG_DIR = /data/content/worldbg (see DEPLOY-RAILWAY.md) so uploaded card photos survive redeploys.

Files: src/worldbg.js (new), src/app.js, src/routes/admin.js, public/js/app.js, public/js/admin.js, public/css/style.css,
public/sw.js (cache v28), scripts/admin-test.js, scripts/seed-volume.js, docs/DEPLOY-RAILWAY.md.

==================================================
== Update: GIF adverts (v2.16.1)
==================================================
UPDATE 40 (v2.16.1): the side adverts can be animated GIFs

- On the admin page, Adverts section, each of the six slots now accepts an animated GIF as well as a JPG or PNG. A GIF keeps moving on the laptop side panels.
- GIF limit: 1.5 MB. A GIF is NOT cropped or resized (that would stop it moving), so make it square (about 600 x 600) before uploading; it is shown cropped to fill the square slot.
- A JPG or PNG is still cropped to a square and shrunk, as before. Uploading a new file to a slot replaces the old one (a GIF replaced by a JPG, or the other way round, is fine). Remove still clears the slot.
- Files saved as content/ads/N.gif (or N.jpg). Nothing to change on Railway: the existing ADS_DIR volume is used.

Files: src/ads.js, src/app.js, src/routes/admin.js, public/js/admin.js, public/sw.js (cache v29), scripts/admin-test.js.

==================================================
== Update: simple home (v2.17.0)
==================================================
UPDATE 41 (v2.17.0): simpler home screen, with left and right buttons on the game cards

- Removed from the home screen: the streak card ("6 day streak" with the week dots and the "Play today's puzzle" button) and the level ladder/journey map with the chest counter.
  The Daily puzzle is still one tap away on the bottom bar, and levels, progress and the chest are still on each game card and in the game itself.
- The home screen is now: welcome line, the latest announcement (if any), the three game cards, and the Invite a friend card.
- The game cards now have a left and a right button. They glide on their own all the time (every 3 seconds, slowly, going round and round).
  If a player touches or presses a button, the sliding waits 4 seconds and then carries on.

Files: public/js/app.js, public/css/style.css, public/sw.js (cache v30).

==================================================
== Update: private chat, edit and delete, mentions (v2.18.0)
==================================================
UPDATE 42 (v2.18.0): edit and delete your messages, private messages, @mentions; slide restarts from the first game

CHAT
- Edit and Delete: every player now sees Edit and Delete under their OWN messages (in the group chat and in private chats).
  Edit changes the text in place and shows "(edited)"; other people who have the chat open see the new text within a few seconds.
  Edited text follows the same rules as a new message (no links, 300 letters). Admins can still delete anybody's group-chat message and mute, as before.
- Private messages: the Chat page has two tabs, Everyone and Private. In Private you see your conversations (last message, a red number for unread)
  and can start one by typing a username. You can also tap Message under anybody's name in the group chat, or the new Message button on a player's profile.
  Only the two players can read a private chat. Admins cannot read or delete private messages. The same no-links, speed and mute rules apply.
  The other player gets an alert in the bell (and a phone notification if switched on). Private messages older than 90 days are cleaned up automatically.
- @mentions: type @ and a few letters in the group chat and name suggestions appear; tap one. A real player's @name is highlighted in the message,
  that player gets an alert ("Ada mentioned you in chat") and the message is marked with a gold edge for them. Up to 3 players are alerted per message.
  Each message under a name also has a Reply button that puts @name in your box.

HOME SCREEN
- When the sliding game cards reach the last game (Word Search) they now fade out and start again from the first (Naija), instead of sliding all the way back.
  The right button does the same on the last card.

Files: src/db.js (chat gets to_id and edited_at columns, added automatically), src/routes/chat.js, public/js/app.js, public/css/style.css,
public/sw.js (cache v31), scripts/chat-test.js (10 checks).

==================================================
== Update: endless slider (v2.18.1)
==================================================
UPDATE 43 (v2.18.1): the home game slider is now a true endless slider

- The three game cards now move every 4 seconds: Naija, then Universal, then Word Search, then straight on to Naija again, Universal, and so on,
  always sliding the same way (no fade, no sliding back). It is slow and smooth (about 1.6 seconds per move).
- How it works: the first two games are repeated after the last one; when the slide reaches the repeat it quietly jumps back to the real card (they look identical).
- Swiping by hand or pressing the left and right buttons works the same, including going left from Naija to Word Search.
  After a touch or button press the automatic sliding waits 4 seconds, then carries on.

Files: public/js/app.js, public/css/style.css, public/sw.js (cache v32).

==================================================
== Update: big races (v2.19.0)
==================================================
UPDATE 44 (v2.19.0): races for up to 20 players, and the host can share the pot between the top 3

PLAYERS
- A race (free or staked) can now have 2 to 20 players. The "How many players?" list goes up to 20. Nothing else changes about lobbies: the host starts the race
  as soon as at least 2 players are in (no need to wait for a full lobby), and everyone who joined plays the same levels.

WHO GETS THE POT (staked races with 9 or more players)
- When the host picks a stake and 9 or more players, a new choice appears: "Who gets the pot?"
    * Winner takes it all (the default, and the only option for races of 8 or fewer players), or
    * Share between the top 3: 60% / 25% / 15%.
- The top 3 are the winner (first to clear every level, or the leader when the 3-day limit ends) plus the two players who had cleared the most levels when the race ended
  (ties broken by score). If two players tie for 2nd, they share the 2nd and 3rd place money equally. If only two players cleared a level, the split is 70% / 30%.
  If nobody except the winner cleared a level, the winner takes everything. Odd leftover coins go to the winner. The whole pot is always paid out.
- Players are told on the join screen, in the lobby and in the invite message which rule applies. Prize winners get an alert, and the results screen lists the prizes.
  The races list shows e.g. "2nd, won 300 coins".

RACE SCREEN
- In a race with more than 8 players the live progress shows a leaderboard: the top 5 plus you, and "+ N more racing".

FIX
- A race ended by the 3-day limit now shows its winner as the winner (and 1st place) on the results screen.

Files: src/routes/challenges.js, public/js/app.js, public/sw.js (cache v33), scripts/group-test.js (19 checks).

==================================================
== Update: dashboard (v2.20.0)
==================================================
UPDATE 45 (v2.20.0): dashboard for you, investors and advertisers

WHAT YOU GET
- New page /dashboard.html (admins only; there is a "Dashboard" button at the top of the Admin page).
  Players: total, new sign-ups, active today / this week / this month, how many come back after 1 and 7 days, players who cleared a level.
  Games: levels cleared per game (Naija, Universal, Word Search), daily puzzles, races made / joined / finished, chat and private messages.
  Money: coin sales in naira (all time and for the period), buyers, average order.
  Adverts: for every side advert and pop-up: views, unique visitors, taps, click rate (pop-ups also: closed by the player), with a daily chart.
  Pick 7 / 30 / 90 days, download a CSV spreadsheet, or print / save as PDF.
- Private links: on the same page, "Make a private link".
    * Investor link: sees everything above (never names, emails or IPs).
    * Advertiser link: sees only the adverts that carry their advertiser name, plus how many players the game has. No revenue.
  Anyone with the link can open it without logging in, so send it only to the right person. You can switch a link off or delete it at any time.
- Admin page: every side advert and pop-up now has an "Advertiser name" box. Type the same spelling on all of one advertiser's adverts. Players never see this name.

COUNTING STARTS TODAY
- Sign-ups, levels cleared and coin sales are already in the database, so those numbers include the past.
- Advert views/taps, daily activity, retention and races/chat/solve counts start counting from the day you install this update.
- No new environment variable and nothing to set up on Railway. Your data folder is kept; new tables are added automatically.

PRIVACY
- Adverts are counted with a random number kept on the player's phone (no name). Bots are ignored. Privacy page has a new sentence about this.

Files: src/stats.js (new), src/routes/dashboard.js (new), src/app.js, src/db.js, src/ads.js, src/routes/admin.js, solo/wordsearch/daily/challenges/chat routes,
public/dashboard.html, report.html, css/dashboard.css, js/dash.js, dashboard.js, report.js, track.js, ads.js, popup.js, admin.js, index.html, sw.js (cache v34),
pages/privacy.html, scripts/dashboard-test.js (4 checks), package.json, README.md.

==================================================
== Update: watch link (v2.21.0)
==================================================
UPDATE 46 (v2.21.0): watch a race live from a shared link

ANSWER TO A QUESTION: yes, a race ends the moment the first player clears every level. The winner is paid, the others are told who won and stop playing.
If nobody finishes, it ends after 3 days and the player with the most levels cleared wins.

WATCH LINK
- In a race lobby, and on the race screen while racing, there are two new buttons: "Share watch link" (WhatsApp) and "Copy watch link".
- The link looks like https://yoursite/#/watch/CODE. Anyone who opens it must have an account (people who are not logged in are sent to log in or sign up, then land on the race).
- Watchers see: the race (levels, category, stake and pot), each racer's progress ("7 of 20 levels"), who won and the prizes when it ends, and a screen that refreshes every 4 seconds.
- Watchers never see the pictures, word searches or answers, and cannot chat or play. If the race is still in the lobby they get a "Join this race instead" button.
- A racer who opens the watch link goes straight to their own race screen.
- Only races can be watched (not old-style challenges).

WATCHING COUNTER
- Racers see "👀 N watching" in the lobby and on the race screen. Each watcher counts once; someone counts while their screen is open (checks in every few seconds).

Files: src/routes/challenges.js, public/js/app.js, public/sw.js (cache v35), scripts/group-test.js (20 checks), package.json, README.md.

==================================================
== Update: theme song (v2.22.0)
==================================================
UPDATE 47 (v2.22.0): the Naija Sabi theme song (afro rap beat)

- An original instrumental afro rap beat, about 94 BPM, that loops forever: log-drum bass, kick, clap, shaker, hi-hats with a small roll, a clave pattern and a kalimba-style
  hook with echo. The melody and rhythm are our own, so there is nothing to license. It is made by the phone with Web Audio: no audio file, works offline, adds almost no size.
- It is OFF until the player turns it on: tap the 🎵 / 🔇 button at the top of any screen, or Me > Sound > "Theme song (afro rap beat)". The choice is remembered on that phone.
  A remembered "on" starts at the first tap (phones do not allow sound before a tap). It fades in and out, and stops when the app is hidden or the screen is locked.
- Sound effects have their own switch, so players can keep taps and wins but turn the music off, or the other way round.
- To make it start ON for new players, change `DEFAULT_ON = false` to `true` at the top of public/js/music.js.
- To change the feel: BPM, SWING and VOLUME at the top of the same file. The hook, bass and drum patterns are the small lists in the middle.
- A real song with vocals cannot be made here. If you make one (for example with Suno or Udio), tell me and I will add it as the theme with the same on/off button.

Files: public/js/music.js (new), public/js/app.js, public/index.html, public/sw.js (cache v36), scripts/music-test.js (3 checks), package.json, README.md.

==================================================
== Update: dashboard delete fix (v2.22.1)
==================================================
UPDATE 48 (v2.22.1): fix, dashboard links could not be deleted ("Send JSON" error)

- The Delete button for investor/advertiser links on /dashboard.html sent the request without the JSON header the server insists on. Fixed: every change from that page now sends it.
- Checked in a real browser: make a link, switch it off, delete it.

Files: public/js/dashboard.js, public/sw.js (cache v37), package.json.

==================================================
== Update: rename to Sabi Naija (v2.23.0)
==================================================
UPDATE 49 (v2.23.0): the game is now called "Sabi Naija", and a new watch-link message

NEW NAME
- Every place a player or visitor can see the name now says "Sabi Naija": the top bar and login screen, page titles, the About, Privacy and Disclaimer pages, emails and
  alerts, the installed-app name, the offline page, the admin page, the dashboard and the investor/advertiser reports, and the WhatsApp invite messages.
- The app icon was redrawn: "NS" is now "SN" (same colours and green-white-green bar).
- Players who installed the app on their home screen may keep the old icon and name until they remove it and add it again (phones cache them).
- Kept on purpose, so nothing breaks: the folder name "naija-sabi", the database file and your data folder, saved settings on players' phones, the Railway service,
  and the zip file names. Nothing to migrate, and nobody is logged out.
- The "Naija" puzzle category is not renamed (it still means Nigerian puzzles).

WATCH LINK MESSAGE
- "Share watch link" now sends: "I am in a live Contest in Sabi Naija. Come watch the Match and show support." followed by the link.

Files: most files in public/, pages/ and src/ (name text only), public/icons/*, public/sw.js (cache v38), package.json, README.md, docs/DEPLOY-RAILWAY.md.

==================================================
== Update: Sliding Puzzle (v2.24.0)
==================================================
UPDATE 50 (v2.24.0): Sliding Puzzle, the 4th game

THE GAME
- A picture is cut into 3x3, 4x4 or 5x5 pieces with one gap. Players tap (or swipe) a piece next to the gap to slide it, until the picture is rebuilt. Arrow keys work too.
- Boards are always solvable (they are made by shuffling the finished picture with real slides). The server checks every slide, so nobody can skip ahead.
- Levels go in order, like the other games. Points: 60 (3x3), 100 (4x4) or 160 (5x5), 10 off for every peek (never below 40%), and a bonus of 20% for finishing within 30/80/160 slides (10% within double that).
- "Peek at the picture" shows the finished picture for a moment and costs 5 coins. Finishing a level gives 10 coins and a chest every 10 levels, like Word Search.

YOU UPLOAD THE PICTURES (Admin page > Sliding puzzle)
- Choose a picture, write a title (e.g. "Zuma Rock"), pick the grid size, add an optional fun fact. Pictures are cropped to a square from the middle and shrunk by the page.
- Add, edit (change title, size, fact or the picture) and delete. New ones go to the end. A deleted picture is skipped for players, and levels after it move up one.
- Start with a few 3x3 pictures so the first levels are easy, then add 4x4 and 5x5.
- Pictures are saved in content/slide/ and the list in content/slide.json. On Railway, keep them on your volume: set SLIDE_DIR (for example /data/slide) and SLIDE_FILE (for example /data/slide.json), the same way as your other content.
- Game card photo: the admin "Game card photos" section now also has Slide Puzzle (otherwise a drawn tile scene is shown).

POINTS AND RANKS
- Slide Puzzle has its own points board in Ranks, and its points also count toward your overall points, title and the weekly prizes.
- The Ranks tabs and the game tabs now have smaller text so all four names (Naija, Universal, Word Search, Slide Puzzle) sit on one line.

RACES
- Challenge > Create race > category "Slide Puzzle" (needs at least 3 pictures; the race has 3 or more puzzles, 5 by default, up to 20 players, stakes and the top-3 split work like the other races).
- Everybody gets the same pictures in the same order with the same shuffle. No hints, no skipping. First to rebuild all of them wins and the race ends on the spot. Points per level in a race are the grid-size points.
- Watch links, the "N watching" counter, invites and rematch all work for sliding puzzle races. In races, "Peek at the picture" is free for everybody.

DASHBOARD
- The dashboard counts sliding puzzles done per day and all time, and lists how many pictures there are.

NOTHING TO SET UP except your pictures. No new environment variable is required (SLIDE_DIR and SLIDE_FILE are only for keeping the pictures on your Railway volume). Existing players keep everything.

Files: src/slide.js, src/routes/slide.js (new); src/routes/challenges.js, admin.js, leaderboard.js, src/app.js, db.js, points.js, stats.js, worldbg.js; public/js/app.js, admin.js, dash.js; public/css/style.css, admin.css; public/sw.js (cache v39); scripts/slide-test.js (7 checks); package.json; README.md.


UPDATE 51 (v2.25.0): Premium members

WHAT PREMIUM GIVES
- No pop-up adverts. (The side adverts on laptops and big screens still show; only pop-ups are hidden.)
- Fun facts. After a level, a puzzle, a word search, a sliding puzzle or the daily puzzle, only Premium members see the fun fact. Everybody else sees a small gold-edged note "There is a fun fact here. Fun facts are for Premium members" that opens the Premium page. The server removes the fact for non-members, so it cannot be seen by looking at the page code.
- A gold crown beside the name in chat, on profiles, on your own profile and on the home greeting.

PRICE AND TIME
- 1,000 naira for 30 days, paid with Paystack (same as Buy coins, needs PAYSTACK_SECRET_KEY and PUBLIC_URL).
- It does not renew by itself and nobody is charged again unless they pay again. When the 30 days end, the crown, fun facts and no-pop-up stop and the player can pay again.
- Paying before it ends adds 30 days on top of the days left. The Premium page warns when 3 days or fewer are left.
- Paying once cannot be counted twice (return page and webhook are both safe). Premium gives no coins.
- To change the price set PREMIUM_NAIRA (optional, default 1000, minimum 100).

WHERE PLAYERS FIND IT
- My profile > "Go Premium" bar, which opens the Premium page (benefits, days left, email, Pay with Paystack). The rules page mentions it too (no refunds once paid).

ADMIN
- Admin page > "Premium members": type a username and days to give Premium by hand (gift, or a payment you got another way). Days stack. Put 0 to remove it.

DASHBOARD
- Money now shows Premium sales (naira and purchases) and Premium members right now. Premium orders are also inside the overall sales figures.

NOTHING TO SET UP. Existing players keep everything. Players who were seeing fun facts will now see the locked note until they go Premium.

Files: src/premium.js (new); src/routes/coins.js, challenges.js, daily.js, solo.js, wordsearch.js, slide.js, admin.js, auth.js, profile.js, chat.js; src/stats.js; public/js/app.js, admin.js, dash.js; public/css/style.css; public/sw.js (cache v40); scripts/premium-test.js (7 checks), slide-test.js; package.json; README.md.


UPDATE 52 (v2.26.0): Win picture with confetti, simpler game header

SLIDING PUZZLE CELEBRATION
- When a player finishes a sliding puzzle level, the finished picture is shown big on the win screen, above the title, points, coins and slides, with confetti falling for about 7 seconds. The picture stays on screen for as long as the player wants: the game only moves on when they tap "Next puzzle", so there is no timer rushing them.
- People who have "reduce motion" switched on in their phone settings do not get the confetti (the picture still shows).
- The picture is small enough that the whole win screen fits on a phone without scrolling the top away.

SIMPLER GAME HEADER
- On the screen where players play (Naija, Universal, Word Search and Slide Puzzle) the row of game tabs is gone. The top now shows only the name of the game being played, next to the level, for example "Slide Puzzle   Level 3".
- To change game, players pick another game on the Home screen (the same carousel as before). The "all levels done" messages now say this too.

NOTHING TO SET UP. No new settings. Existing players keep everything.

Files: public/js/app.js, public/css/style.css, public/sw.js (cache v41), package.json, README.md (no change), docs.


UPDATE 53 (v2.26.1): Small tidy-up after the bug check

- The Naija, Universal, Word Search and Slide Puzzle screens no longer ask the server for the list of games (the tabs that used it are gone), so they open with one less request. The unused tab code was removed.
- Dashboard: "Players who bought coins", its percentage and "Average coin purchase" now count coin orders only. Premium buyers are shown separately in the Premium numbers. Sales totals still include both.

NOTHING TO SET UP. Files: public/js/app.js, dash.js, src/stats.js, public/sw.js (cache v42), package.json, docs.


UPDATE 54 (v2.27.0): Premium is locked until you open it

You asked to keep Premium switched off until the game has many players. Premium is now LOCKED by default.

WHAT LOCKED MEANS
- Nobody can buy Premium. The "Go Premium" bar on My profile is hidden, the Premium page says it is not open yet, and the Premium paragraph is left out of the rules page.
- Fun facts show for EVERYBODY again (nothing is hidden behind a lock), so players are not annoyed before Premium exists.
- Pop-up adverts show to everybody except players who already have Premium. Anyone you gave Premium by hand (or who paid before) keeps their crown and their days. Payments already in progress still finish.

HOW TO OPEN IT LATER
- Admin page > "Premium members" > tick "Premium is open to players". The note under it tells you whether it is OPEN or LOCKED and how many members there are. Untick it to lock again.
- When open: players can buy it for N1,000 per 30 days, fun facts are only for members, and the Go Premium bar and rules text appear.
- The choice is saved in DATA_DIR/premium.json (on Railway that is your volume), so it survives restarts and updates.
- Paystack still has to be set up (PAYSTACK_SECRET_KEY, PUBLIC_URL) before anyone can pay.

You can still give Premium to people by hand while it is locked.

Files: src/premium.js, src/routes/coins.js, admin.js, auth.js; public/js/app.js, admin.js; public/sw.js (cache v43); scripts/premium-test.js (8 checks); package.json; docs.


UPDATE 55 (v2.27.1): Word Search and Sliding Puzzle levels now show on profiles

FIXED
- A player's profile (their own My profile page and the page other players open from chat or Ranks) only showed Points, Naija level, Universal level and Best streak. It now also shows the Word Search level and the Slide Puzzle level, so all four games are there. The six numbers sit three to a row.

NOTHING TO SET UP. Existing players' levels were already saved; they simply show now.

Files: src/routes/solo.js, auth.js, profile.js; public/js/app.js, style.css, sw.js (cache v44); scripts/slide-test.js; package.json; docs.


UPDATE 56 (v2.28.0): "Go Premium" line under pop-up adverts

- Under every pop-up advert there is now a small line: "Tired of adverts? Go Premium for no pop-up adverts, fun facts and a gold crown by your name." "Go Premium" is a link: tapping it closes the advert and opens the Premium page.
- HIDDEN UNTIL YOU OPEN PREMIUM. While Premium is locked (the default), the line is not shown at all. It appears the moment you tick "Premium is open to players" on the Admin page (Premium members). Untick it and the line disappears again.
- Premium members never see pop-ups, so they never see the line.

NOTHING TO SET UP.

Files: public/js/popup.js, public/css/popup.css, src/routes/admin.js (the pop-up list tells the page whether Premium is open), public/sw.js (cache v45), scripts/premium-test.js (checks the line is off when locked and on when open), package.json.


UPDATE 57 (v2.28.1): Word Search and Sliding Puzzle timer no longer restarts

WHY IT HAPPENED
The clock on these two games only ran on the player's phone. It started at 0:00 every time the level screen opened, and the server never knew how long the player had already spent, so leaving and coming back started it from the beginning (the found words and the slide positions were saved, the time was not).

FIXED
- The time spent on a level is now saved on the server. It is sent with every word found / slide, and also when the player leaves the page or switches to another app, so the time is kept even if they leave between moves.
- When the player comes back to the same level, the clock carries on from where it stopped.
- The clock now pauses while the page is hidden (phone locked or another app open), so time away is not counted.
- The time is only a display; it does not change points, so nothing about scoring changed. A saved time can never go backwards.
- Races: the race screens still show their own clock from the start of each level (race results use the server's race time, as before).

NOTHING TO SET UP. Levels already in progress start from 0:00 once and are saved from then on.

Files: src/routes/wordsearch.js, slide.js; public/js/app.js; public/sw.js (cache v46); scripts/wordsearch-test.js, slide-test.js; package.json; docs.


UPDATE 58 (v2.29.0): Word Search letter hint costs 10, Naija and Universal puzzles split on the admin page

WORD SEARCH
- "Reveal a letter" (mark the first letter of a word) now costs 10 coins instead of 15. Revealing a whole word still costs 30. The button text in the game shows the new price by itself.
- Solo Naija / Universal "Reveal" is unchanged (15 coins).

ADMIN PAGE
- The single "Puzzles" section is now two separate foldable sections like the others: "Naija puzzles" and "Universal puzzles".
- Each has its own search box, its own count ("104 Naija puzzles, 104 without a picture") and its own "Add Naija puzzle" / "Add Universal puzzle" button, which opens the form with that category already chosen. Edit and Delete work as before.
- Both start folded, and the page remembers which ones you left open. "Open all" and "Close all" include them.

NOTHING TO SET UP.

Files: src/routes/wordsearch.js, public/js/admin.js, scripts/wordsearch-test.js, package.json, docs.


UPDATE 59 (v2.29.1): New slogan on the login page

- "Look. Think. Answer." is now "Play. Learn. Sabi."
- The little "Naija" and "Universal" labels under the slogan are removed, so the login page is cleaner (the players and online counts stay).
- Share messages for races and the page description still say "look, think, answer". Tell me if you want those changed to the new slogan too.

NOTHING TO SET UP.

Files: public/js/app.js, public/css/style.css, public/sw.js (cache v47), package.json, docs.


UPDATE 60 (v2.30.0): Sponsored races (step 1)

WHAT IT IS
A free race you set up for a brand. Players see it on their home screen with the sponsor's logo, name and prize, join for free, and race the normal way: same levels for everybody, first to finish all of them wins.

SET IT UP (Admin page > "Sponsored race")
1. Type the sponsor name, the prize (for example "N5,000 airtime"), an optional link and an optional logo (shrunk for you).
2. Pick the game (Naija, Universal, Word Search or Slide Puzzle), the levels (picture races need at least 20, word search and sliding puzzle races are shorter) and the most players that can join (up to 200).
3. Press "Create sponsored race". It shows on every player's home screen straight away.
4. When enough players have joined, press "Open the race lobby" and then "Start race". You are the host, so DO NOT play it yourself (the prize is for the players). You need at least one player in it to start.
5. When it is over, check the winner and send the prize yourself. The winner sees "You won the [sponsor] prize" and is told you will contact them by email.

WHAT PLAYERS SEE
- Home screen: a gold card "Sponsored race by [sponsor] / Win [prize]" with a Join button (Open once they have joined, Watch once it has started).
- Join page, race lobby and finish screen: the sponsor box with logo, "Sponsored by", the prize and "Visit sponsor".
- No coins are taken: sponsored races are always free, even if a stake were sent.
- The watch link works as for other races, so anybody with an account can watch it live.

THE SPONSOR REPORT (Admin page > Sponsored race > Sponsor report)
For each race: players who saw the card (counted once per player), taps on the sponsor link, players joined, players finished, the winner and the status. Send these numbers to the sponsor.

OTHER DETAILS
- Only the admin can create a sponsored race. Everybody else gets "Only the admin can set up a sponsored race".
- A sponsored lobby is not closed by the 48 hour clean-up, so you can announce it days ahead and start when you are ready. Cancel it from the lobby if you change your mind.
- The host is not counted as a player on the home card and the join page.
- Up to 3 open sponsored races show on the home screen, newest first. Finished and cancelled ones disappear.

COMING IN STEP 2 (if you want it): a start time with a countdown and automatic start, an announcement to everyone when it opens, a report link for the sponsor (like the advertiser links), and winner checking before the prize is shown as paid.

NOTHING TO SET UP. No new settings.

Files: src/routes/challenges.js; public/js/app.js, admin.js; public/css/style.css; public/sw.js (cache v48); scripts/sponsor-test.js (6 checks); package.json; docs.


UPDATE 61 (v2.31.0): Sponsored races, step 2

1. START TIME AND COUNTDOWN
- When you create a sponsored race you can pick a start time (optional). The home card, the join page and the lobby show "Starts in 2h 5m (Sat, 8 Nov, 20:00)" and count down live.
- At that time the race starts by itself, as long as at least one player has joined. If nobody has joined yet, it starts the moment the first player joins after the time. Leave the start time empty to press Start race yourself, as before.
- A start time must be in the future and within 90 days.

2. ANNOUNCEMENT
- Create form: "Tell everybody" (ticked by default) posts an announcement ("Sponsored race: win N5,000 airtime"), the same line in the chat, and an alert to every player, including the start time if you set one. Untick it for a quiet race.

3. WINNER CHECKING
- When a sponsored race ends, the prize is NOT shown as paid. It starts as "being checked". You also get an alert to check the winner.
- Admin page > Sponsored race > Sponsor report > the finished race shows: the winner's name and email, how old the account is, points, races played, seconds per level, and warning signs:
  * account created after the race was announced, or less than a day old
  * very fast finish (under about 6 seconds a level for pictures, 10 for slide, 20 for word search)
  * other accounts using the same email
  * no email on file
  Warnings are hints, not proof. You decide.
- Buttons: Approve (the winner is told it is approved), Mark as paid (the winner is told the prize is sent), Reject (the prize passes to the next player who finished the race; if nobody else finished, there is no prize winner and nobody is named).
- A paid prize cannot be changed any more.
- Players see: the winner "We are checking your entry" then "Approved, the prize is being sent" then "Your prize has been sent". Other players see "[Name] won the prize. The winner is being checked / the prize is being sent / the prize has been sent."
- You still send the prize yourself (airtime, data, voucher or cash). The app tracks the status only.

4. SPONSOR REPORT LINK
- Every sponsored race has its own private link: Sponsor report > "Copy sponsor report link". Send it to the sponsor on WhatsApp or email. It needs no login, shows the logo, prize, status, start time, how many players saw the race, tapped the sponsor link, joined and finished, and the winner's username once the winner is approved or paid. It never shows emails.

NOTHING TO SET UP. Races made with v2.30.0 keep working (they have a report link too).

Files: src/routes/challenges.js, src/app.js; public/js/app.js, admin.js, sponsor-report.js (new); public/sponsor-report.html (new); public/css/style.css, admin.css, dashboard.css; public/sw.js (cache v49); scripts/sponsor-test.js (11 checks); package.json; docs.
UPDATE 62 (v2.32.0): Quiz (the fifth section) - LOCKED until you open it

WHAT IT IS
A place where schools, groups and churches test their members. A host types questions, gets a 6-letter code and a link, shares it on WhatsApp, and members race through the questions. There is a leaderboard. No AI question maker yet (that comes later).

LOCKED BY DEFAULT
- Admin page > Quiz > tick "Quiz is open to players" when you are ready. Until then players see nothing; only you (the admin) see a "Quiz" card on the home carousel marked "Locked: only you see this" so you can try it.
- Who can host: only you, plus players you approve by username (Admin > Quiz > Approve host). Or tick "Let every player host quizzes". Everybody can JOIN with a code.
- "List" (admin) puts a quiz on the public list on the Quiz page. Otherwise players need the code or link.

HOSTING
- Make a quiz: title, optional topic, seconds per question (8-90, default 20), optional closing time, 3 to 50 questions, 2 to 4 answers each, right answer marked, optional short explanation.
- "Paste many questions at once": one block per question, answers as A) B) C) or -, put * (or "(correct)") after the right answer.
- Host controls: Edit, Results, Close/Reopen, Delete. Questions and timing freeze once the first player starts (title and closing time can still change).
- Results page: every player, score, correct answers, time, how each question went, and a CSV download for a spreadsheet. No emails are shown.
- Limits: 30 quizzes kept per host, 10 new quizzes a day (admin is not limited).

PLAYING
- Enter the code on the Quiz page or open the link. One question at a time with a timer bar; right and wrong answers show with the explanation.
- 100 points for a right answer plus up to 50 for answering fast. Ranked by score, then total time.
- Fair play: the right answers are never sent to the phone before answering, each player sees the answers in a different order, the timer is kept by the server (reloading does not reset it), and a late answer counts as wrong.
- Quiz scores do NOT change global points, ranks, titles or coins.

NOTHING TO SET UP. Settings are saved in DATA_DIR/quiz.json (keep your data volume). New tables are created automatically.

Files: src/quiz.js (new), src/routes/quiz.js (new), src/routes/auth.js, src/app.js; public/js/app.js, admin.js; public/css/style.css; public/sw.js (cache v50); scripts/quiz-test.js (18 checks); package.json; docs.
UPDATE 63 (v2.33.0): Race timer set by the host

WHAT'S NEW
- When a player creates a race (Challenge page) there is a new "Race timer (optional)" list: no timer, 5, 10, 15, 20, 30, 45 minutes, 1, 2, 3, 6, 12 hours or 24 hours. The default is no timer (first to finish all levels wins, as before).
- The timer starts when the host presses Start (or when a sponsored race starts by itself). Before that the lobby and the join page just show the length ("Timer: 20 minutes").
- During the race everyone sees a live "Time left" clock that turns red in the last minute.
- When the timer runs out the race ends by itself:
  * the player who cleared the most levels wins (a tie on levels is settled by points);
  * if they are still level, or nobody cleared a level, the race closes with no winner and every stake is refunded;
  * the winner takes the pot (or the top-3 split in big races), exactly like a normal win; everybody gets an alert saying who won.
- If somebody finishes all the levels before the timer ends, they win straight away as always.
- Ending is exact: the server checks every 10 seconds and also the moment anybody opens or plays the race, so nobody can sneak in an answer after time is up.
- The old 3-day limit for started races still applies to races without a timer.

NOTHING TO SET UP. Existing races are not affected.

Files: src/routes/challenges.js; public/js/app.js, public/css/style.css, public/sw.js (cache v51); scripts/racetimer-test.js (7 checks); package.json; docs.
UPDATE 64 (v2.34.0): Google AdSense on the side screens and pop-ups

You can now paste AdSense ad code on the Admin page, the same way you upload pictures.

HOW TO USE (after you apply to AdSense and the game is live on your own web address)
1. Admin > "Google AdSense": type your publisher ID (ca-pub-...; AdSense > Account > Account information). Leave "Show Google ads" OFF and save.
   The game then adds Google's verification tag to the home page and serves /ads.txt (both are what Google checks when you add the site).
2. When Google approves the site, in AdSense create display ad units (Ads > By ad unit) and copy each code box.
3. Admin > "Adverts": every one of the six slots (Left 1-3, Right 1-3) has a new box "Or paste AdSense code here". Paste, press "Save AdSense code". (Pasting just the ad slot number also works.)
   Pop-ups: Admin > "Pop-up adverts" > "Add an advert" > paste code > "Add AdSense pop-up".
4. Admin > "Google AdSense": tick "Show Google ads" and save. Switch it off any time to go back to your own pictures.

WHAT HAPPENS
- A slot with AdSense code shows the Google ad (while AdSense is ON) instead of its picture; other slots keep their pictures. Picture adverts and Google ads can sit side by side.
- A small "Advertisement" label sits above each Google ad, never on top of it.
- Premium members still get no pop-ups (that includes Google pop-ups).
- Only the checked publisher ID, ad slot number and size are taken from what you paste. Nothing else from the pasted text is ever put on the page.
- While AdSense is ON the game lets the browser load Google's scripts (nothing else is loosened; the game still cannot be put inside another website). While OFF nothing changes.
- The Privacy Policy page mentions Google AdSense and cookies by itself while AdSense is ON (and says "no advertising trackers" while it is OFF).
- Google ads are measured by Google, not by the Dashboard report. Your own picture/pop-up numbers are unchanged.

GOOGLE'S RULES TO KNOW
- Never ask players to tap ads and never tap them yourself. Do not put Google ads right beside buttons players tap a lot.
- Google does not allow its ads in pop-ups that open without a tap, and may disable ads. The pop-up that shows after a level is a grey area: test with the side slots first. The Admin page says this too.
- Most of the game is behind login. Google can only check public pages, so approval may ask for more public content (About us, Privacy, Disclaimer pages already exist). If Google refuses, you can keep selling your own picture adverts.
- Visitors from Europe/UK need a consent message: in AdSense go to Privacy & messaging and switch on the consent message.

NOTHING TO SET UP ON RAILWAY. Settings are kept in content/ads/adsense.json (ADS_DIR if you moved adverts to the volume).
I could not show a real Google ad from here (no Google account); the ad boxes, headers and tags were checked on a test server. After you switch it on, open the game once and look for any red message in the browser console (F12) if an ad box stays empty.

Files: src/adsense.js, src/adsPath.js (new); src/ads.js, src/popups.js, src/pages.js, src/app.js, src/routes/admin.js; pages/privacy.html; public/js/ads.js, popup.js, admin.js; public/css/ads.css, popup.css, admin.css; public/sw.js (cache v52); scripts/adsense-test.js (11 checks); package.json; docs.
UPDATE 65 (v2.35.0): Watch an advert, get coins (players choose)

WHAT IT IS
Players who would rather watch an advert than buy coins can do it. They tap "Watch an advert, get 5 coins" in the coins box (the + next to their coins, and anywhere the game says "Buy coins"). The advert plays full screen; when the wait is over the button says "Collect 5 coins". Tapping it closes the advert and the coins are added. Nothing is forced on anybody.

SWITCH IT ON (Admin > "Watch adverts for coins")
- Tick "Players can watch adverts for coins" and save. It is OFF until you do.
- You set: coins per advert (default 5), seconds the player must watch (default 10), most adverts per player per day (default 10), seconds to wait between adverts (default 60).
- It shows how many adverts were watched and how many coins were given.

WHICH ADVERTS
- The ones in Admin > "Pop-up adverts" (your advertisers' pictures, GIFs and videos). Each now has a box "Use for coin rewards" (ticked by default).
- An advert can be reward-only: untick "Active (pops up by itself after levels)" and keep "Use for coin rewards" ticked. Adverts take turns.
- Google AdSense cannot be used for this (AdSense has no reward-for-watching ads for websites), so the AdSense section from update 64 stays off unless you want it for the side slots.
- If you want adverts ONLY as a reward, untick "Show pop-up adverts" in the Pop-up adverts section.

ANTI-CHEAT
- The server keeps the clock: coins come only if the full time passed since the advert was sent, so skipping, editing the page or repeating the request does nothing.
- One claim per advert; one advert at a time per player; daily limit and wait between adverts; the count restarts at midnight Nigeria time.
- The countdown waits while the player is on another tab.
- If the picture or video will not load, the advert closes and no coins are given.
- Premium members can still watch for coins if they want.

NOTHING TO SET UP. Settings are saved in DATA_DIR/rewards.json.

Files: src/rewards.js, src/routes/rewards.js (new); src/app.js, src/routes/admin.js; public/js/app.js, popup.js, admin.js; public/css/style.css; public/sw.js (cache v53); scripts/reward-test.js (12 checks); package.json; docs.
UPDATE 66 (v2.36.0): "Watch an advert for coins" removed

As you asked, the coin reward for watching adverts (update 65) is gone, and pop-up adverts work exactly as they did in version 2.34.0.

- Removed: the "Watch an advert, get coins" button in the coins box, the Admin "Watch adverts for coins" section, the "Use for coin rewards" box on each pop-up advert, and the server code behind them.
- Pop-up adverts: back to the way they were: they pop up after levels (Admin > "Pop-up adverts" > Show pop-up adverts, every N levels, close button after the wait), Premium members see none, and the "go Premium" line still shows once Premium is open.
- Google AdSense (update 64) is unchanged and still OFF until you switch it on.
- If a rewards.json file exists in your data folder from testing, it is no longer used; you can delete it.

Files: src/app.js, src/routes/admin.js; public/js/app.js, popup.js, admin.js; public/css/style.css; public/sw.js (cache v54); package.json; src/rewards.js, src/routes/rewards.js and scripts/reward-test.js deleted; docs.
UPDATE 67 (v2.36.1): Quiz report sheet for the host

- The host of a quiz (and the admin) can download a report sheet any time, and it is most useful once the quiz has ended or been closed. Two places: a new "Report sheet" button in Host controls on the quiz page, and "Download report sheet" on the Results page.
- The sheet opens in Excel, Google Sheets or any spreadsheet app (a .csv file named quiz-CODE-report.csv). It has:
  * the quiz title, code, how many players started and finished;
  * one row per player: rank, name, finished or not, questions answered, score, number correct, total seconds, and Right/Wrong for every question (Q1, Q2, ...);
  * a second table: each question, how many players got it right, how many reached it, and the percent right.
- Names that start with = + - or @ are made safe so a spreadsheet can never run them as a formula; accents and emoji in names show correctly in Excel.
- Players never see this sheet and it contains no emails.

Files: src/routes/quiz.js; public/js/app.js; public/sw.js (cache v55); scripts/quiz-test.js; package.json; docs.
UPDATE 68 (v2.36.2): "Online" counter hidden from players

- The login screen and the top of every game screen now show only "N players" (registered). The green "online" number is gone for everyone except the admin.
- The admin still sees "N online (only you see this)" on the game screens, and "Online right now" in the Dashboard.
- The investor report link still shows "Online right now" (investors see everything). Advertiser links never showed it.
- The numbers are no longer even sent to other players' phones (not just hidden), so nobody can find them by looking at the page's data.
- The small green dot next to an individual player in private messages, and "Online now" on a player's profile, are unchanged (they show whether that one friend is around). Tell me if you want those hidden too.

Files: src/routes/chat.js, src/routes/auth.js; public/js/app.js; public/sw.js (cache v56); scripts/chat-test.js; package.json; docs.
UPDATE 69 (v2.37.0): Settings page, contact and social links

WHAT'S NEW FOR PLAYERS
- The speaker/music button at the top is now a gear (Settings). Tapping it opens a Settings page.
- Settings has: Sound (sound effects on/off, theme song on/off; moved here from the Me page) and "Contact and follow us".
- Contact and follow us is a list of clickable rows (the whole row is a link that opens in a new tab):
  * Message the developer on WhatsApp (for adverts, partnerships or any problem; opens a chat with your number with a ready "Hello Sabi Naija..." message)
  * Join our WhatsApp channel
  * Follow @handle on X
  * Follow @handle on Instagram
  * Follow @handle on TikTok
  * Follow your page on Facebook
- Only the rows you fill in appear. If you fill in none, players see no contact section.

WHAT YOU DO (Admin > "Contact and social links")
- Type your WhatsApp number with country code (08012345678 also works), the channel link, and your X, Instagram, TikTok handles and Facebook page name. A handle, a plain name or a full link all work; leave a box empty to hide that row. Press "Save links". Changes show at once.
- Only links to those websites are accepted. Anything else (other websites, look-alike addresses, scripts) is refused with a message.

ICONS
- The rows use simple stand-in icons (coloured squares with WA, CH, X, IG, a music note and f), not the official logos.
- To use the official icons: download them from each platform's brand page and save them as contact.svg, channel.svg, x.svg, instagram.svg, tiktok.svg and facebook.svg in public/img/social/ (create the folder). They replace the stand-ins by themselves.

Files: src/social.js, src/routes/social.js (new); src/app.js; public/js/app.js, admin.js; public/css/style.css; public/sw.js (cache v57); scripts/social-test.js (6 checks); package.json; docs.
UPDATE 70 (v2.37.1): Wording

On the Settings page, the WhatsApp row now says "Contact us on WhatsApp" (it used to say "Message the developer on WhatsApp"). Nothing else changed.

Files: public/js/app.js; public/sw.js (cache v58); package.json; docs.
UPDATE 71 (v2.38.0): Storage saver

1. Old races are cleaned up. Every hour the server deletes finished and cancelled races that ended more than 5 days ago (set RACE_KEEP_DAYS to change it). Wins, points and stats are on each player, so they are not lost. Races still running, and sponsored races (used by advertiser and investor reports), are never deleted. An old race link or alert now opens as "race not found".
2. Smaller profile photos: new photos are 160x160 (about 5 to 12 KB instead of 15 to 40 KB), and the server limit is 40 KB. Photos already uploaded keep working.
3. Smaller level pictures: when you upload a picture puzzle or a sliding-puzzle picture on the admin page, it is now saved at a lighter size (collage 600 px, up to 250 KB; sliding picture 720 px, up to 380 KB).

Files: src/db.js; src/routes/challenges.js; src/routes/profile.js; public/js/app.js; public/js/admin.js; public/sw.js (cache v59); scripts/raceclean-test.js (new); scripts/profile-test.js; package.json; docs.
UPDATE 72 (v2.39.0): Avatars instead of photos, 200-message chat, pinned messages

1. No more photo uploads (they used disk space). Players now pick a display picture from a built-in set: 4 men and 4 women (vector icons in different skin tones, hair and colours) and 6 animated faces (happy, cool, laughing, in love, star eyes, winking). They are drawn in the browser, so they use no storage: the server saves only a short key. The picker is on the Me page ("Choose a picture"). Players who had uploaded a photo keep it until they pick a picture; picking one (or removing) deletes the old photo file. Animations stop for people who turn on "reduce motion" on their phone.
2. The public chat keeps only the latest 200 messages (it was 1000). Private messages are still kept for 90 days.
3. Admins can pin admin messages (Pin / Unpin on the message, up to 3 at a time). Pinned messages show in a bar at the top of the chat for everybody and are never cleared, until unpinned or deleted.
4. Admins can delete announcements: on the admin page (as before) and now also with a "Delete announcement" button on the Announcements page.

Files: src/avatars.js (new); public/js/avatars.js (new); src/db.js; src/routes/profile.js; src/routes/chat.js; public/js/app.js; public/css/style.css; public/index.html; public/sw.js (cache v60); scripts/profile-test.js; scripts/chat-test.js; package.json; docs.
UPDATE 73 (v2.40.0): Protection against fake accounts and coin farming

1. Email confirmation. When email sending is set up (RESEND_API_KEY + MAIL_FROM), every new account is emailed a confirmation link (works 3 days; opens #/verify/...). Until the player opens it they can play normally, but they cannot host or join staked races, collect weekly coin prizes, or earn or give invite coins. A reminder bar with "Send the link again" (one a minute) shows until they confirm. Changing the email on the Me page asks for confirmation again and the old link stops working. Players who joined before this update are not affected. With no email sending set up, nothing is blocked. Set EMAIL_VERIFY=off to switch the feature off.
2. Invite coins: the friend must have confirmed their email, and an inviter is now paid for at most 5 friends a day (on top of the existing 20 in total). The friend still gets their own coins.
3. Cloudflare Turnstile on sign-up (free "I am human" check). Off until you set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY on Railway (from dash.cloudflare.com > Turnstile, add your site's domain). When on, sign-up needs the check; if Cloudflare cannot be reached, sign-up is refused with a "try again" message. The secret key never leaves the server.
Weekly prizes skipped for an unconfirmed player are not given to the next player.

Files: src/verify.js (new); src/turnstile.js (new); src/app.js; src/routes/auth.js; src/routes/invites.js; src/routes/challenges.js; src/routes/chat.js; src/weekly.js; public/js/app.js; public/css/style.css; public/sw.js (cache v61); scripts/verify-test.js (new); scripts/account-test.js; package.json; README.md; docs.
UPDATE 74 (v2.40.1): "null" text fix and password help requests for the admin

1. Fixed: the word "null" showed at the top of every screen after logging in. It came from the email-confirmation reminder bar in v2.40.0, which printed "null" when there was nothing to show. Now nothing is printed.
2. Password help requests. When a player taps "Forgot password" and the account exists, the admin now sees it: a new foldable section "Password help requests" on the admin page lists who asked, their email on file, when, and what happened (reset email sent, no email on file, or the email could not be sent). For each open request the admin can give a temporary password (which also closes the request) or mark it done. The Me page's admin button shows how many requests are waiting. Players never see this; names that do not exist are not recorded; requests are kept for 30 days.

Files: public/js/app.js; public/js/admin.js; public/css/admin.css; public/sw.js (cache v62); src/db.js; src/routes/auth.js; src/routes/admin.js; scripts/account-test.js; package.json; docs.
UPDATE 75 (v2.40.2): Temporary passwords that are easy to use

A tester could not log in with a temporary password from the admin. The login itself was fine; the likely causes were look-alike characters (l/I, 0/O), a phone adding a capital letter or a space when the password was copied or pasted, and sending the whole sentence instead of just the password. Fixes:
1. Temporary passwords are now 10 lowercase letters and digits with no look-alikes (no 0/o, 1/l/i), shown in a big box with a "Copy password" button (both in "Help a player" and "Password help requests").
2. While a player is still on a temporary password, login also accepts it with a capital letter or spaces added.
3. After logging in with a temporary password, a bar tells the player to choose their own password and takes them to the Me page; it goes away once they change it (or reset by email).
4. The server logs a warning when requests come through a proxy but TRUST_PROXY is not set. Without it, all players share one login limit (25 tries per 10 minutes for everybody), so players can be blocked with "Too many attempts". On Railway set TRUST_PROXY=1.

Files: src/routes/admin.js; src/routes/auth.js; src/app.js; public/js/admin.js; public/js/app.js; public/css/admin.css; public/sw.js (cache v63); scripts/account-test.js; package.json; docs.
UPDATE 76 (v2.40.3): See the password you type

On the log in and Create account form, the padlock icon in the password box is now a button. Tap it to show what you typed (the padlock opens); tap again to hide it. This helps players catch typing mistakes, especially with temporary passwords. It works on both tabs and keeps what was typed.

Files: public/js/app.js; public/css/style.css; public/sw.js (cache v64); package.json; docs.
UPDATE 77 (v2.40.4): Show / Hide on the other password boxes

The password boxes on the "choose a new password" page (opened from the reset email) and on the Me page (confirm your password when saving an email, current password, new password) now have a Show / Hide button on the right, so players can check what they typed. (The log in screen already had this on the padlock.)

Files: public/js/app.js; public/css/style.css; public/sw.js (cache v65); package.json; docs.
UPDATE 78 (v2.41.0): Account details on password requests, and an optional recovery question

Helps the admin be sure a person asking for a password reset really owns the account.
1. Account details. Each open request in "Password help requests", and the "Help a player" lookup, now shows: joined date, last login, email on file, levels in each game, coins and points, friends invited, Premium, and the last 3 paid coin purchases (with the Paystack reference). The last login is recorded from this version on (older accounts show "not recorded" until they log in).
2. Recovery question (optional). A player can pick a question (mother's first name, primary school, favourite meal, town born, childhood best friend, first phone) and an answer, either when creating the account ("Add a recovery question") or later on the Me page (asks for the password). Only a scrambled hash of the answer is stored, so nobody can read it. When someone cannot use the email reset, the admin sees the question on the request, asks the person, types their answer into "Check their answer" and gets only "Matches" or "Does not match". Capital letters, extra spaces and punctuation do not matter.
Advice: ask for at least two proofs when the account has no email, and never share a temporary password in public chat.

Files: src/recovery.js (new); src/routes/auth.js; src/routes/admin.js; public/js/app.js; public/js/admin.js; public/css/style.css; public/css/admin.css; public/sw.js (cache v66); scripts/account-test.js; package.json; docs.
UPDATE 79 (v2.42.0): Delete my account

1. Me page > "Delete my account": the player types their password and the word DELETE. The account is deleted 3 days later; until then they can keep playing and tap "Cancel deletion" (on the Me page or in the bar shown at the top). They are emailed when they ask and when it is done (if the game can send emails).
2. Public page /delete-account (linked from the login screen, the Me page, and the Privacy Policy) for people who cannot log in. They type their username or email. If the account has an email, a confirmation link is sent; opening it starts the same 3-day countdown. If it has no email, the request appears in the admin page ("Password help requests") for the admin to check by hand. The page gives the same answer whether or not the account exists.
3. What is removed: profile, email, picture, recovery answer, coins, points, levels, Premium time, chat messages (public and private), alerts and push alerts, quiz results and quizzes they hosted, reset links, activity counts. Their finished races stay in other players' history showing "Deleted player". A lobby that only invited them is closed (stakes refunded). Payment records are kept (law and accounting) without the email, as "deleted". The username and email can be used again.
4. A player inside a race that has not ended is deleted as soon as the race ends (a race ends within 3 days at most). Checked hourly.
5. Admin: "Delete this account now" in "Help a player" and on each password/delete request (confirmation asked; admin accounts cannot be deleted; if the player is in a running race it is done when the race ends).
6. Privacy Policy updated (retention, rights) and a new Delete your account page. Have a lawyer read it.

Files: src/accountDelete.js (new); src/routes/auth.js; src/routes/admin.js; src/routes/challenges.js; src/db.js; src/app.js; src/pages.js; pages/delete-account.html (new); pages/privacy.html; public/js/delete-account.js (new); public/js/app.js; public/js/admin.js; public/css/style.css, admin.css, pages.css; public/sw.js (cache v67); scripts/delete-test.js (new); package.json; docs.
UPDATE 80 - v2.43.0 - Admin can pause the public chat room

1. Admin page > "Public chat room": Pause chat for 15 minutes, 1 hour, 6 hours, 1 day or until you open it, with an optional message players see.
2. While paused, players can read the room but cannot write or edit there; they can still delete their own messages. Admins can still write. Private messages are not affected.
3. Players see "Chat is paused by the admin" with your message and the time it reopens, and the box is switched off. A timed pause ends by itself.
4. The pause is saved, so it survives a restart.

Files: src/chatlock.js (new); src/routes/chat.js; public/js/app.js; public/js/admin.js; public/sw.js (cache v68); scripts/chat-test.js; package.json; docs.
UPDATE 81 - v2.44.0 - Staking removed, race winners announced in the public chat

1. Staking is gone. Races are free: the "Coin stake" and "Who gets the pot" choices are removed from the Challenge page, and nobody pays in or wins coins in a race. If an old app screen still sends a stake, the server ignores it. Sponsored-race prizes (given by the sponsor) are unchanged.
2. Races that were already created with a stake before this update still end the old way (refunds if cancelled or never started, pot paid to the winner), so nobody loses coins.
3. When a race (or a 2-player challenge) finishes with a winner, the public chat shows: "Ada [party face] just defeated Bola [crying face], Chidi [crying face] and Emeka [crying face]". The faces are animated. Up to 6 losers are named, then "and N more". The admin can delete a result line.
4. When a player deletes their account, result lines naming them are removed from the chat.
5. Text updated: About, Disclaimer (stakes paragraph replaced), Privacy (race results shown in chat), Rules, email-confirmation messages.

Files: src/routes/challenges.js; src/routes/chat.js; src/db.js; src/accountDelete.js; src/verify.js; pages/about.html, disclaimer.html, privacy.html; public/js/app.js; public/css/style.css; public/sw.js (cache v69); scripts/group-test.js, chat-test.js, racetimer-test.js, verify-test.js, wordsearch-test.js; package.json; docs.
UPDATE 82 - v2.44.1 - Switch for the race winner announcements

1. Admin page > "Public chat room": new tick box "Race results in chat". Untick it and the game stops posting "A just defeated B, C" lines; tick it to bring them back. It takes effect at once and is saved across restarts.
2. Lines already in the chat stay until they scroll away or you delete them (Delete on each line).

Files: src/chatlock.js; src/routes/chat.js; src/routes/challenges.js; public/js/admin.js; public/sw.js (cache v70); scripts/chat-test.js, group-test.js; package.json; docs.
UPDATE 83 - v2.44.2 - Chat announcements name the winner only

1. The chat line is now "Ada [party face] just won a race against 3 other players!". Losers are no longer named or stored, and the crying faces are gone.
2. Older result lines already in the chat that listed losers now show as "Ada just won a race!" (the losers are dropped from the display).
3. The admin on/off switch for announcements is removed (not needed). Players can still hide the lines for themselves in Settings > Chat.
4. Disclaimer and rules wording updated.

Files: src/routes/challenges.js; src/routes/chat.js; src/chatlock.js; public/js/app.js, admin.js; public/css/style.css; public/sw.js (cache v71); pages/disclaimer.html; scripts/chat-test.js, group-test.js; package.json; docs.
UPDATE 84 - v2.44.3 - Picture owners section on the Disclaimer

Disclaimer page: new "Pictures and copyright" section. Says pictures are AI-made, our own, or found online; we claim no ownership of others' pictures; owners can email {{CONTACT_EMAIL}} (subject "Picture removal") with name, where it appears, proof of ownership and a true-statement; we review and usually remove within a few days. Admin removes a picture from Admin > puzzles (delete the puzzle and the picture file).
IMPORTANT: this text does not by itself protect against a copyright claim. Best protection: replace pictures taken from Instagram/Pinterest with AI-made, own or licensed ones over time, answer every owner email quickly, and have a Nigerian lawyer read the page. Check your contact email works.

Files: pages/disclaimer.html; package.json; docs.
UPDATE 85 - v2.44.4 - Fix: Admin page showed nothing

A typo I made in public/js/admin.js (a missing closing bracket when the announcement switch was removed in v2.44.2/2.44.3) stopped the whole Admin page from loading. Fixed. The test run now also checks that every script file parses, so a typo like this is caught before you get the files.
If you installed v2.44.2 or v2.44.3, install this one.

Files: public/js/admin.js; public/sw.js (cache v72); scripts/syntax-test.js (new); package.json; docs.
UPDATE 86 - v2.45.0 - Safer AdSense (no Google ads in pop-ups or beside the chat)

Google's AdSense rules do not allow its ads in pop-ups, or on screens centred on private communication such as live chat. To protect the account:
1. Pop-ups carry your own adverts only. The "paste AdSense code" box for pop-ups is removed, the server refuses it, any AdSense pop-up saved earlier is ignored, and the player's phone never shows one.
2. The side advert panels (laptops) are hidden while a player is on the chat screens, so no AdSense ad appears beside the chat.
3. Hint text on the Admin AdSense section updated.

Also do (in your AdSense account, not in the game): keep "Auto ads" switched OFF, because Auto ads can place ads anywhere, including pop-ups and chat. Use only the manual ad boxes in the Admin page. Never tap your own ads or ask players to tap them. Re-read https://support.google.com/adsense/answer/1346295 after Google approves the site.

Files: src/popups.js; src/routes/admin.js; public/js/admin.js, popup.js, app.js; public/css/style.css; public/sw.js (cache v73); scripts/adsense-test.js; package.json; docs.
UPDATE 87 - v2.46.0 - Sliding puzzle: memorise the picture first

1. When a player opens a new sliding puzzle level, the finished picture shows for 10 seconds with a countdown. Then the picture is covered and the screen says "Ready?" with a Start button. The board, the timer and the slide count begin only when they press Start (the memorising time does not count).
2. If a player leaves and comes back, the countdown is not shown again: they go straight to the board. This also stops a player from refreshing the page again and again to look at the picture for free.
3. A player who was already part-way through a puzzle before this update goes straight to the board too.
4. Sliding puzzle RACES are unchanged (no countdown), so every racer starts at the same moment.
5. "Peek at the picture" (costs coins) still works after Start.

Files: public/js/app.js; public/css/style.css; public/sw.js (cache v74); package.json; docs.
UPDATE 88 - v2.47.0 - Naija pictures for sliding puzzles, and a watermark

1. Sliding puzzle can use a picture from the Naija game. Admin > Sliding puzzle > "Or use a picture from the Naija game": type a Naija answer, pick the grid size, press "Use this picture". Nothing new is stored: the level shares the Naija puzzle's picture. The title and fun fact are filled from that puzzle (you can edit them). Those pictures need a login to view, like the Naija ones. If you rename the Naija puzzle, the level follows it; if you delete it, the level is skipped and shows as "picture missing".
2. Watermark. New Admin > Watermark section. Type the text (up to 30 characters; empty = off). It is printed small in the bottom right of every puzzle picture, sliding puzzle picture and game card photo you upload on the Admin page, so it stays on the file if someone saves it. A live preview shows how it looks. Default text: "Sabi Naija". Sponsor adverts, pop-ups, logos and login backgrounds are NOT stamped.
3. "Add the watermark to my existing pictures": a one-time button that stamps all puzzle and sliding pictures saved before today (originals are replaced; keep the page open; has a Stop button). Pictures saved after the watermark started are skipped. Running it a second time asks for confirmation, because it would stamp twice.
4. Changing the text only affects pictures uploaded afterwards (the old text stays on old pictures). A watermark in the corner can be cropped out by someone determined: it discourages casual copying, it does not make copying impossible.
5. Sliding puzzle pictures are cut into pieces; the corner piece with the watermark is the gap while playing and shows when the puzzle is finished.

Files: src/watermark.js (new); src/slide.js; src/app.js; src/routes/admin.js; public/js/admin.js; public/css/admin.css; public/sw.js (cache v75); scripts/naijapic-test.js (new); package.json; docs.
UPDATE 89 - v2.47.1 - Disclaimer: AI cartoons of public figures

Disclaimer > Pictures and copyright: new paragraph "Cartoons of public figures" (AI-made cartoons or illustrations based on well-known people; drawings not photographs; shown only so players can guess the puzzle; not approved by, supported by or connected to the people shown). The removal paragraph now also covers a cartoon of a person or someone they represent: they can ask for removal without proving copyright, just by saying who they are and which puzzle it is.
Reminder: this reduces risk, it does not remove it. Likeness / personality-rights rules can apply even to cartoons, especially in a game that earns from ads or Premium. Keep cartoons tasteful and clearly drawings, avoid anything embarrassing, sexual or political, answer any complaint quickly, and have a Nigerian lawyer read the page.

Files: pages/disclaimer.html; package.json; docs.
UPDATE 90 - v2.48.0 - "Install Sabi Naija" buttons

The game could already be installed as a web app (manifest, icons, offline page) and showed a small bar at the bottom ("Install Sabi Naija on your phone", with an iPhone hint). New:
1. Settings: an "Install the game" card at the very top, above Sound / Theme song and Contact and follow us. The "Install Sabi Naija" button opens the browser's install window. If the browser has not offered installing (for example Safari on iPhone, or Chrome has not decided yet), the card shows how to do it by hand: iPhone "Share, then Add to Home Screen"; Android "browser menu, then Install app or Add to Home screen".
2. Home: a "Get the app" card under "Invite a friend", shown once the player has closed the bottom bar (so there is never a double ask).
3. Both cards disappear (Home) or say "installed" (Settings) once the game runs as an installed app.
4. One shared install helper now (public/js/pwa.js, NS.install), so the browser's install window cannot open twice.
Not a Play Store app: for that see the Android plan (TWA/Capacitor) discussed earlier. Installing only needs the website; there is no extra storage cost.

Files: public/js/pwa.js; public/js/app.js; public/css/style.css; public/sw.js (cache v76); package.json; docs.
UPDATE 91 - v2.48.1 - Friendlier wording in the cartoons paragraph

Disclaimer > Cartoons of public figures: the last two sentences were reworded to "Sabi Naija is not connected to any of the people shown, and they have not approved or endorsed the game. We respect them, and if anyone would like a cartoon removed, we will take it down."

Files: pages/disclaimer.html; package.json; docs.
UPDATE 92 - v2.49.0 - Low-data and weak-connection update

WHAT CHANGED
1. Smaller downloads. Text answers (pages, scripts, styles, chat, JSON) are now sent compressed (Brotli, or gzip on older phones).
   Typically 65-80% smaller. Pictures are not touched. New file: src/compress.js. Test: scripts/compress-test.js.
2. Data Saver (Settings > Data Saver). Turns itself on if the phone asks for data saving or the connection is 2G, until the
   player chooses. When on: chat, alerts and "who is online" are checked about 3x less often, GIF and video pop-ups are
   skipped, the game-page photos and side adverts are left out, animations stop. Puzzle pictures still show.
   New file: public/js/saver.js.
3. Saved pictures. Puzzle pictures (/pic and /sl) are kept on the phone after the first view (up to 80), so they open at once
   and work on a weak connection. They are forgotten on log out. Answers, profile photos and every /api reply are never saved.
4. Weak-connection mode. A small "Weak connection. Reconnecting..." bar appears when requests fail. Reading requests retry
   quietly 3 times. Sending an answer is never repeated automatically, and the typed answer stays on screen.

NOT DONE / LIMITS
- The server cannot shrink puzzle pictures (no image library). Smaller pictures should be uploaded by the admin.
- No full offline play: answers live on the server so they cannot be cheated.
- Next-level picture preloading is not done (the server does not say which puzzle comes next).

FILES: src/compress.js, src/app.js, public/js/saver.js, public/js/app.js, popup.js, ads.js, public/sw.js (cache v77), index.html,
public/css/style.css, scripts/compress-test.js, package.json (2.49.0).
UPDATE 93 - v2.50.0 - AdSense header for phones, smaller buttons

WHAT CHANGED
1. Phone header ad. The side adverts only fit on laptops, so phones and tablets (screens under 1100px) now get one Google ad in a
   fixed strip at the top of the game. Admin page > Google AdSense > "Phone header ad": paste an AdSense Display ad code
   (a small horizontal banner such as 320x50 or 320x100 works best) and save. It shows only while AdSense is ON, is kept apart
   from the game buttons, is labelled "Advertisement", is never in pop-ups or chat-style screens, and is hidden when the player's
   Data Saver is on. Laptops are unchanged.
2. Smaller controls on phones and tablets: letter buttons are 40px high (were square), the gap between the letters and between
   Reveal / Shuffle / Clue / Skip is smaller, and on short screens the picture grid shrinks a little, so the header ad, letters and
   hints fit together.

NOTES
- Keep Auto ads OFF in AdSense. Do not put anything clickable right next to the ad.
- On very short phones (about 640px tall) the four hint buttons can sit just under the bottom menu until the player scrolls a little.

FILES: src/adsense.js, src/routes/admin.js, public/index.html, public/js/ads.js, public/js/admin.js, public/css/ads.css,
public/css/style.css, public/sw.js (cache v78), scripts/adsense-test.js (12 checks), package.json (2.50.0).
UPDATE 94 - v2.50.1 - Tidier home and bigger puzzle pictures

- Home: the profile picture beside "Welcome back" is smaller (56px, was 92px) and the space above it is reduced.
- Puzzle screen: the extra game name above the picture (for example NAIJA) is removed, because the name already shows next to the level.
- The puzzle picture is bigger on phones, tablets and laptops (about 30% more height allowed), using the space the title left.

FILES: public/js/game.js, public/css/style.css, public/sw.js (cache v79), package.json (2.50.1).
UPDATE 95 - v2.50.2 - Player count only in chat, slimmer game top line

- The line with the number of registered players (and, for the admin, players online) is removed from every page except the public chat room, where it stays above the messages. The dashboard still shows the numbers. The space the line used is gone.
- Game page (phones): the top line with the game name and level (for example "Naija ... LEVEL 6") now uses smaller text, less space around it, and the level is plain text with no shape around it.

FILES: public/js/app.js, public/css/style.css, public/sw.js (cache v80), package.json (2.50.2).
UPDATE 96 - v2.50.3 - Late clickers on a race link see the race

- Opening a race JOIN link after the race has started, finished or been cancelled no longer ends in "Could not join". The player is taken to the watch page: live progress while the race runs, and the final positions (with coins won) once it is over.
- Players who were in the race still go to their own results; old-style challenges are unchanged.

FILES: public/js/app.js, public/sw.js (cache v81), package.json (2.50.3).
UPDATE 97 - v2.51.0 - Income tracker (owner dashboard)

WHERE: the owner dashboard page (Admin page > Dashboard), new "Income" section under the report. Admin only. It is NOT in the investor or advertiser links.

- Coin sales and Premium sales are filled in by themselves from the paid payment records, by month (Nigeria time).
- AdSense, Sponsored races and Other are typed in: month, where from, amount, naira or dollars (for dollars, type the naira rate for $1; both are kept), and an optional note. Entries can be deleted.
- Monthly table with a total for each month and a "% compared with last month" line. Amounts are in naira.
- The game cannot read your AdSense account, so copy the figure from AdSense yourself.
- Entries are kept in data/income.json on the Railway volume (back it up with the rest of the data folder).

FILES: src/income.js (new), src/db.js, src/routes/dashboard.js, public/js/dashboard.js, scripts/income-test.js (new, in npm test), package.json (2.51.0).
UPDATE 98 - v2.52.0 - AdSense banner on the race results page

- New box on the Admin page > Google AdSense: "Race results page ad". Paste a Display ad code and save.
- It shows ONE banner on the full page players see when a race has finished (below the standings, with clear space around it, away from the buttons). It is never in a pop-up or on the level-complete box, never in chat, and is hidden when the player has Data Saver on. It shows only while AdSense is switched on.
- Between-level full-screen and rewarded ads are NOT built. On the web they are only possible through Google's separate "H5 Games Ads" (Ad Placement API), which you must apply for after your AdSense account is approved: https://developers.google.com/ad-placement/docs/signup . Google decides approval. If you are approved, send me the code Google gives you and I will add it.
- Keep AdSense Auto ads OFF (the game is one page, so chat cannot be excluded from Auto ads).

FILES: src/adsense.js, src/routes/admin.js, public/js/ads.js, public/js/admin.js, public/js/app.js, public/css/ads.css, public/sw.js (cache v82), scripts/adsense-test.js (13 checks), package.json (2.52.0).
UPDATE 99 - v2.52.1 - Fresh AdSense ad on a new screen (no page reload)

- When a player moves to a new page, or presses Next after finishing a level, each visible AdSense ad (phone header, laptop side units) is replaced by a fresh ad request. The game is NOT reloaded: music, chat, timers and progress are untouched and no extra data is downloaded.
- Never more than once every 60 seconds, never while the tab is hidden, never with Data Saver on. It only happens when the player really moves to something new, so it is not a timed refresh.
- Direct adverts (pictures you sell yourself) are left as they are. The race-results banner is made fresh with its page.
- Auto ads stay OFF (chat cannot be excluded). A reload after every level was NOT built: it risks counting as inflated impressions, costs players data and loses their place.

FILES: public/js/ads.js, public/js/app.js, public/sw.js (cache v83), package.json (2.52.1).
UPDATE 100 - v2.52.2 - Data Saver removed

- The Data Saver switch (Settings) and everything it did are gone: slower chat/alert checks, skipping GIF/video pop-ups and game photos, hiding adverts, stopping animations. Ads and pop-ups now show for every player.
- Kept from update 92: compressed downloads, saved puzzle pictures, and the weak-connection banner with quiet retries.
- Players who had turned Data Saver on: the old setting is simply ignored.

FILES: public/js/app.js, popup.js, ads.js, admin.js, public/index.html, public/css/style.css, public/sw.js (cache v84), public/js/saver.js (deleted; delete it from your folder too), package.json (2.52.2).
UPDATE 101 - v2.53.0 - The game is now called PixSabi

- Every player-facing "Sabi Naija" is now "PixSabi": page titles, the logo text (PIXSABI), the install name and "Install PixSabi" bar, emails (confirm email, reset password, delete account), share messages, push notification title, the chat results sender, legal pages (about, disclaimer, privacy, delete account), reports, admin and dashboard pages, offline page, README.
- New app icon (PS with the green-white-green bar) in all four sizes. Phones that already installed the old app keep the old icon and name until they remove and re-install it.
- NOT changed on purpose (so nothing breaks): the data file name (naija-sabi.db), the folder name, saved settings on the volume, and the "Naija" game category.
- The picture watermark you already saved keeps its text until you change it on Admin > Watermark (new installs default to "PixSabi").
- Still to do by you: update the name in Railway MAIL_FROM (for example PixSabi <hello@yourdomain.com>), the PUBLIC_URL if you get a new domain, your Google AdSense / Search Console site name, social account names, and the contact lines in content/site.json if they mention the old name.
- Check the name "PixSabi" is free before you promote it: domain, social handles, app stores, trademark registry.

FILES: 38 text files with the name, public/icons/*.png (new), public/sw.js (cache v85), package.json (2.53.0, description only).
