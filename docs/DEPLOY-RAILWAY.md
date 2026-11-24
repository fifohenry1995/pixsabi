# Put Sabi Naija on Railway (step by step)

You need: a GitHub account, a Railway account (railway.com), and the `naija-sabi` folder from the full zip.
Railway is a paid service after its trial credit, so check railway.com/pricing first. Run ONE copy of the game only (it uses a single SQLite database).

## 1. Before you upload
1. Open `content/site.json` and fill in your business name, email, address, website and date (the Privacy, Disclaimer and About pages use it).
2. Do NOT upload `data/` or `node_modules/` (the `.gitignore` already skips them).

## 2. Put the folder on GitHub
1. Install Git (git-scm.com) and make a free account at github.com.
2. On github.com click New repository, name it `naija-sabi`, choose **Private**, Create.
3. In the `naija-sabi` folder open a terminal and run:
   git init
   git add .
   git commit -m "Sabi Naija"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/naija-sabi.git
   git push -u origin main

## 3. Create the project on Railway
1. Railway > New Project > Deploy from GitHub repo > pick `naija-sabi` (allow Railway to see it).
2. It builds and starts with `npm start`. The folder has a `.node-version` file and "engines" so Railway uses Node 22 or newer. (If the build log shows an older Node, set the Node version in Railway's variables as described in their docs.)

## 4. Add a Volume (so players and puzzles survive redeploys)
1. In the project, click the service, then Add Volume (or right-click the project canvas > Volume), mount path: `/data`.
2. Without a volume everything is wiped at every deploy.

## 5. Variables (service > Variables)
Required:
- `DATA_DIR` = `/data/db`
- `PUZZLES_FILE` = `/data/content/puzzles.json`
- `WORDSEARCH_FILE` = `/data/content/wordsearch.json`
- `IMAGE_DIR` = `/data/content/images`
- `ADS_DIR` = `/data/content/ads`
- `POPUPS_DIR` = `/data/content/popups`
- `LOGINBG_DIR` = `/data/content/loginbg`
- `WORLDBG_DIR` = `/data/content/worldbg`
- `SESSION_SECRET` = a long random string (mash the keyboard for 40+ characters)
- `COOKIE_SECURE` = `true`
- `TRUST_PROXY` = `1`
- `ADMIN_USER` = your own username (create your account in the game first, then set this and redeploy)
- `VAPID_SUBJECT` = `mailto:you@yourdomain.com`
- `PUBLIC_URL` = your site address, e.g. `https://naija-sabi.up.railway.app` (set after step 6; change to your own domain later)
The first start copies your starter puzzles and pictures onto the volume (`scripts/seed-volume.js`); after that the admin page edits them there and nothing is overwritten.
Optional: `RESEND_API_KEY` and `MAIL_FROM` (forgot-password emails), `PAYSTACK_SECRET_KEY` (buy coins; add the webhook URL `https://YOUR-SITE/api/paystack/webhook` in Paystack).

## 6. Get a web address
1. Service > Settings > Networking > Generate Domain. You get an `xxx.up.railway.app` address. Set `PUBLIC_URL` to it and redeploy.
2. Own domain (e.g. naijasabi.com): Networking > Custom Domain > add it, then add the CNAME record Railway shows at your domain registrar. Wait for it to turn green, then update `PUBLIC_URL`.

## 7. Check it works
1. Open the address, create your account, then (after setting `ADMIN_USER`) open `/admin.html`.
2. Make a test player, solve a level, post an announcement, open `/privacy`.
3. Redeploy once and confirm your account and puzzles are still there (that proves the volume works).

## Updating the game later
Copy the update files over your folder, then: git add . , git commit -m "update" , git push. Railway redeploys by itself and the volume keeps your data.

## Backups
Your players live in `/data/db/naija-sabi.db`. Use Railway's volume backup feature if your plan has it, and also download the puzzle backups the admin page makes, now and then.
