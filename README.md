# PixSabi

A "look, think, answer" picture game built on Nigerian food, places, stars, slang and culture.
Players sign up, solve puzzles, keep a daily streak, climb the leaderboard and
challenge friends. It uses **only Node.js built-in modules**, so there is nothing
to `npm install`.

## Run it

You need Node.js 22.13 or newer (check with `node -v`; get the LTS version from nodejs.org).

```bash
cd naija-sabi
npm start
```

Open http://localhost:3000. Check everything works with `npm test`.

## What is in the game

| Part | How it works |
| --- | --- |
| Play (solo) | Random unsolved puzzles. 100 points each, minus 20 per revealed letter and 10 for the clue (never below 40). Each solve gives 10 coins. You start with 100 coins. Reveal costs 15 coins, Clue costs 5, Skip costs 20, Shuffle is free. The same puzzle stays until you solve or skip it. |
| Zoom the picture | Tap the puzzle picture (it has a small magnifier) to open it full screen. Pinch with two fingers, double-tap, use the + and - buttons or the mouse wheel to zoom, drag to move around, tap outside the picture or press Esc to close. |
| Levels | Your level is the number of puzzles you have solved, plus one. It goes up by one each time you solve a puzzle. |
| Daily | One puzzle for everyone each day (Lagos time), no hints. Solve it on consecutive days for a streak and bonus points. |
| Game picker | The home screen shows Naija, Universal and Word Search as big cards you swipe between (they also glide on their own every 3 seconds). Backgrounds are drawn scenes; upload real photos on the admin page (Game card photos). |
| Word Search | A third tab next to Naija and Universal. Find the hidden words in a letter grid by dragging over them. Levels, hints, chests, points toward Ranks. Add word lists on the admin page (content/wordsearch.json). Can also be raced: pick Word Search as the race category. |
| Challenge (race) | 2 to 20 players race over the same levels, 20 or more (up to every puzzle in the game), chosen by whoever creates it. Everyone joins the lobby by code or WhatsApp link, the host taps Start race, and the first player to finish ALL the levels wins at once. Skipping costs 10 points and the level comes back at the end. No hints in a race. The host can set a coin stake (0 to 1000, default none): every player pays it when they join and the winner takes the whole pot (in races of 9 or more players the host can choose to share it between the top 3, 60/25/15); it is refunded if the host cancels, a player leaves the lobby, or nobody starts the race within 24 hours (no refunds after the start). Challenges made before version 2.0 (5 puzzles, highest score wins) still work. |
| Categories | Two categories only: Naija 🇳🇬 and Universal 🌍 (for players in every country). A switch on the Play page lets anybody move between them at any time. Each category has its own levels, shown on the profile. A race is played inside one category and needs at least 20 puzzles in it. Every puzzle has a Category set to Naija or Universal in the admin page (older names like Food are treated as Naija). |
| Points, titles and leaderboards | Points can't be spent and never go down; they decide rank titles (Newcomer, Learner, Sabi Person, Gist Master, Oga Sabi, Area Champion, Naija Legend), the coloured frame around a player's photo, and four leaderboards: Overall, This week, Naija and Universal. The top 3 of each week (Monday to Sunday, Lagos time, at least 100 points) win 200, 100 and 50 coins. Profiles also show badges (first race win, streaks, Naija and Universal milestones, weekly champion). Change the title points and badges in `src/titles.js`, and the prizes in `src/weekly.js`. |
| Sound effects | Soft sounds on every button, tab and menu item, plus their own sounds for letter tiles, coin buttons, right and wrong answers, race wins and alerts. Made on the phone with the browser's own audio, so there are no sound files to download. Players switch them off on the Me page. |
| Alerts | A bell in the top bar. Players get an alert when a friend challenges them by name, when a race they joined starts, and when someone else wins it. Shown in the game (banner and Alerts page) and, if the player turns it on, as a phone or browser notification even when the game is closed. Works over HTTPS only (and on localhost). On iPhone the game must be added to the Home Screen first. |
| Chat room | One room for every player (Chat tab). Plain text, up to 300 letters, at most 15 messages a minute, newest 1000 kept. Admins can delete a message or mute a player for 24 hours. |
| Live counts | A strip under the top bar (and on the login screen) shows registered players and players online now (seen in the last 2.5 minutes). |
| Ranks and profiles | Top 25 players. Each player has a short description and a display picture picked from a built-in set of icons and animated faces (no uploads). |
| Admin page | Add, edit and delete puzzles, change the advert pictures and the pop-up adverts. |
| Sliding puzzle | The 4th game. Upload pictures on the Admin page (Sliding puzzle): a title, a grid size (3x3, 4x4 or 5x5) and a picture, which is cut into a square. Players slide pieces next to the gap to rebuild it. Levels go in the order you added them; points depend on the grid size, with a bonus for few slides and a small cost for peeking. It has its own Ranks tab, a home card, dashboard numbers and races (everybody gets the same pictures and the same shuffle). Pictures live in `content/slide/` (or `SLIDE_DIR`) and the list in `content/slide.json` (or `SLIDE_FILE`): on Railway point both at your volume, like the other content. |
| Premium | 1,000 naira for 30 days through Paystack, no automatic renewal (pay again, early payment adds 30 days). Premium members see no pop-up adverts, get the fun facts (everyone else sees a locked note) and a gold crown by their name in chat and on profiles. Premium is LOCKED until you tick "Premium is open to players" on the Admin page (then it can be bought and fun facts become members-only). Admin can also give or remove Premium by hand. Optional `PREMIUM_NAIRA` changes the price. |
| Theme song | An original afro rap beat (log-drum bass, clap, hats, clave, kalimba hook) made by the phone itself, no file to download. Off until a player taps the 🎵 button at the top (or Me > Sound > Theme song). It is remembered per device and stops when the app is hidden. To start it ON for new players, set `DEFAULT_ON = true` at the top of `public/js/music.js`. |
| Watch link | In a race lobby or while racing, tap **Share watch link**. Any logged-in player with the link (`/#/watch/CODE`) can watch the race live: how many levels each racer has cleared and who wins. Watchers never see pictures or answers, and racers see "N watching". |
| Dashboard | `/dashboard.html` (admins only, also linked from the Admin page): players, daily/weekly/monthly active, retention, games, races, chat, coin sales, and how every advert and pop-up performs (views, visitors, taps, click rate). Make private links (`/r/...`) for investors (everything) or for one advertiser (only their adverts); switch a link off any time. Download CSV or print. Give each advert an advertiser name on the Admin page. Counting starts the day this update runs. |
| Buy coins | A **+** next to the coin count (and a Buy coins button on Me) lets players buy coin packs with Paystack: 200 coins N500, 600 coins N1,200, 1,500 coins N2,500. Coins are added only after Paystack confirms the payment. |
| Install as an app | Players can install it on their phone (needs an https website, see below). |

Answers, clues and fun facts stay on the server. The browser only gets a picture,
the jumbled letters and a random-looking puzzle id.

## Puzzles: 104 to start

Food (25), Places (16), Stars (14), Slang (14), Culture (22), Naija Life (13).
Until a puzzle has a picture it shows four emoji tiles, so the game works while you add pictures.

### Add and edit puzzles (easiest): the Admin page
1. Open `content/admin.txt`, put your username on a line (remove the `#`), save, restart the game.
2. Log in as that user, open **Me**, tap **Admin: manage puzzles** (or go to `/admin.html`).
3. **Add puzzle**: answer (3 to 12 letters), category, clue, fun fact and your collage picture. It is live at once.
4. **Edit** or **Delete** from the list. Renaming an answer keeps players' credit and renames the picture file.
5. Every change saves a dated backup of the list in `content/backups/` (newest 30 kept).

### Pictures by hand
Put one collage per puzzle in `content/images/`, named after the answer in small letters: `jollof.jpg`, `supereagles.png` (JPG, PNG or WEBP). Run `npm run images` to see which are missing.

### Edit the list by hand
`content/puzzles.json`: `a` answer (capital letters), `c` category, `clue`, `fact`, and optional `t` (4 emoji tiles) used only while there is no picture. Then run `npm run validate`.

## Adverts

On the Admin page:
- **Adverts**: up to six square pictures beside the game on laptops and big screens (1100 px wide and up): three on the left and three on the right. Each can have a link. Empty slots are hidden and the other pictures grow to use the space. Stored in `content/ads/`.
- **Pop-up adverts**: a picture, GIF (up to 2.5 MB) or video (MP4 or WEBM, up to 4 MB) shown after every Nth level in solo play (default 10, you can change it). The Close button appears after a few seconds. Up to 10 adverts that take turns. Stored in `content/popups/`. Never shown in challenges or the Daily puzzle.

## Put it online

Any host that runs Node.js works (Render, Railway, Fly.io, a VPS).

1. Start command: `npm start`.
2. Environment variables:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (most hosts set it). Default 3000. |
| `VAPID_SUBJECT` | Contact for the push services, like `mailto:you@yourdomain.com`. Set it in production. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional. The alert keys are made automatically and saved in `data/.vapid.json` (keep it in your backups: if it is lost, players must turn alerts on again). Set these two only if you want the same keys on several servers. |
| `SESSION_SECRET` | A long random string that signs login cookies. Set it in production. |
| `COOKIE_SECURE` | Set to `true` once your site uses HTTPS. |
| `TRUST_PROXY` | Set to `1` behind a proxy or load balancer so rate limits see the real visitor IP. |
| `DATA_DIR` | Folder for the database. Point it at a persistent disk. |
| `DB_CACHE_ROWS` | Optional. Players and challenges kept in memory (default 5000 each). |
| `PAYSTACK_SECRET_KEY` | Turns on Buy coins. `sk_test_...` to try it with fake money, `sk_live_...` for real money. Without it the Buy button says "not open yet". |
| `PREMIUM_NAIRA` | Optional. Premium price for 30 days in naira (default 1000). |
| `PUBLIC_URL` | Your website address, e.g. `https://naijasabi.com`. Used to send players back after paying. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Turns on the Cloudflare "I am human" check on sign-up (free at dash.cloudflare.com, Turnstile). Both keys needed; blank = off. |
| `EMAIL_VERIFY` | Email confirmation of new accounts is on whenever `RESEND_API_KEY` and `MAIL_FROM` are set. Set `EMAIL_VERIFY=off` to switch it off. |
| `RESEND_API_KEY`, `MAIL_FROM` | Turns on forgot-password and email-confirmation emails (free account at resend.com, verify your domain). `MAIL_FROM` looks like `PixSabi <hello@yourdomain.com>`. Needs `PUBLIC_URL` too. |
| `AUTH_LIMIT` | Optional. Sign-in/sign-up tries allowed per 10 minutes per visitor (default 25). |
| `ADMIN_USER` | Admin usernames, separated by commas (an alternative to `content/admin.txt`). |

3. **Persistent storage matters.** Keep `data/` (it holds `naija-sabi.db`) AND `content/` on a disk that survives deploys (players, profile photos, your puzzles, pictures, adverts and backups live there).
4. **Use https.** Phones only allow "Install app" on https sites (or localhost on the same computer).

## About, Privacy and Disclaimer pages

The pages are at `/about`, `/privacy` and `/disclaimer`. Fill in `content/site.json` (business name, contact email, address, website, date). Until then they show a yellow reminder. They are drafts: get a Nigerian lawyer to review them before launch.

## Buy coins with Paystack

1. Make a free account at https://paystack.com and finish their business setup (needed to receive real money).
2. In the Paystack dashboard open **Settings > API Keys & Webhooks**. Copy the **Test Secret Key** (`sk_test_...`).
3. On your host set `PAYSTACK_SECRET_KEY` to that key and `PUBLIC_URL` to your website address (https). Restart the game.
4. On the same Paystack page set **Test Webhook URL** to `https://YOUR-SITE/api/paystack/webhook` and save.
5. Try it: tap the **+** by your coins, pick a pack, pay with Paystack's test card (see their Test Payments page). Your coins go up and the receipt shows in the Paystack dashboard.
6. When happy, switch the key to your **Live Secret Key** (`sk_live_...`) and put the same URL in **Live Webhook URL**.

How it stays safe: the price list lives on the server (`PACKS` in `src/routes/coins.js`, edit prices there), the amount Paystack reports must match, the webhook signature is checked, and each payment can only add coins once. Run `npm run orders` to see who bought what. Money is held and paid out to your bank by Paystack, not by this game. Because the game takes real payments you should also have your own terms (no refunds on coins, etc.) and tell players about them.

## Project layout

```
naija-sabi/
  content/
    puzzles.json         all puzzles (the Admin page edits this)
    images/              one collage picture per puzzle
    admin.txt            usernames allowed to use the Admin page
    ads/ popups/ backups/   created by the Admin page
  src/
    server.js app.js     start-up, routing, security headers, file serving
    db.js                SQLite database (data/naija-sabi.db) and profile photos (data/avatars)
    puzzles.js           loads puzzles, hidden ids, picture links, letter pools
    paystack.js          talks to Paystack (start a payment, check it, check webhook signatures)
    ads.js popups.js     advert storage
    util.js              password hashing, tokens, helpers
    routes/              auth, profile, solo, daily, challenges, leaderboard, admin, coins
  public/                the website (HTML, CSS, JavaScript, icons, service worker)
    admin.html           the Admin page
  scripts/               puzzle validator, picture check and the tests
  docs/CHANGELOG.md      history of every update
  data/                  database and profile photos (created on first run)
```

## Good to know

- Passwords are hashed with scrypt. Logins use a signed, HttpOnly cookie. Login and signup are rate limited.
- Puzzle pictures are served only to logged-in players through private links; file names (which are the answers) are never sent.
- The Admin API answers "not found" to everyone who is not an admin.
- The database is SQLite (built into Node, nothing to install): one row per player and per challenge, saved in milliseconds, with indexes for the leaderboard, rank, search and "my challenges". Tested with 50,000 players and 100,000 challenges. It runs in one server process; if you ever need several servers you would move to Postgres.
- Upgrading from the old file database: if `data/db.json` exists it is imported automatically on first start and kept as `db.json.imported-...`.
- Back up with `npm run backup` (safe while the game is running; keeps the newest 14 in `data/backups/`).
- There is no email or phone verification and no password reset yet. Back up `data/` regularly.
- Tests (`npm test`) run against copies, so they never touch your real puzzles, pictures or players.

## Railway, step by step
See `docs/DEPLOY-RAILWAY.md`.
