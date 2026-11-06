# Device checklist

Manual checks that automation cannot do: real Google consent, a camera scan between two devices,
the native pull-to-refresh gesture, push delivered to a real phone, a real Google claim with a
brand-new account, the native share sheet, and messenger link previews of the deployed site. Each
section lists prerequisites, exact steps, the expected outcome and the evidence to send back.
Commands run from the repo root (`/Users/cp/code/sharkulator`) on the Mac.

None of these checks has been performed by automation. Automated tests and browser runs cover the
inbox, notification preferences, push sending through a local collector, the claim rules with a
simulated Google identity, the share page HTML and the PNG card. They do not prove that a phone
receives a push, that real Google consent completes a claim, or that WhatsApp or iMessage render a
preview. Record each result yourself.

| #   | Check                                      | Devices                                     | Needs                                      |
| --- | ------------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| 1   | Real Google login on web                   | Mac browser                                 | Google client secret                       |
| 2   | Two-device QR game                         | Mac browser + iPhone (Expo Go)              | -                                          |
| 3   | Native pull-to-refresh on the feed         | iPhone (Expo Go)                            | -                                          |
| 4   | Push on a real phone                       | iPhone or Android phone (development build) | EAS project ID, APNs/FCM credentials       |
| 5   | Real Google claim with a brand-new account | Mac browser (+ phone for the native part)   | Google client secret, a never-used account |
| 6   | Native share sheet                         | Phone (Expo Go or development build)        | -                                          |
| 7   | Messenger link preview after deploy        | Phone with WhatsApp or iMessage             | Your production deployment                 |

Sections 1-3 keep their original assertions (VAL-MANUAL-GOOGLE-001, VAL-MANUAL-QR-001 and the
native portion of VAL-MOBILE-001).

Never paste secrets, tokens, or `.env` contents into chat or screenshots.

## 0. Preparation (once)

1. Start the backend and load demo data:

   ```sh
   docker compose up -d
   i=0; until curl -sf localhost:3100/health; do i=$((i+1)); if [ "$i" -ge 60 ]; then echo "API not healthy after 60 s; run: docker compose logs api" >&2; break; fi; sleep 1; done; echo
   [ "$i" -lt 60 ] && npm run seed -w apps/backend   # idempotent; runs only once the api is up
   ```

   The second line waits up to 60 seconds for `/health` and prints
   `{"status":"ok","database":"up"}` when the api is ready (it applies migrations first). If it
   prints `API not healthy after 60 s` instead, the seed is skipped: check
   `docker compose logs api` and run both lines again.

2. Check `apps/mobile/.env`: `EXPO_PUBLIC_DEV_AUTH` must equal `DEV_AUTH_SECRET` from the root
   `.env` (this enables **DEV SIGN-IN**). Without printing either value:

   ```sh
   [ "$(grep '^DEV_AUTH_SECRET=' .env | cut -d= -f2)" = "$(grep '^EXPO_PUBLIC_DEV_AUTH=' apps/mobile/.env | cut -d= -f2)" ] && echo synced || echo NOT-synced
   ```

3. For sections 2 and 3 (iPhone): find the Mac's LAN address with `ipconfig getifaddr en0` and set
   `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3100` in `apps/mobile/.env`. Section 1 works with either
   `localhost` or the LAN address, so you can set this once for the whole session.
4. Start the dev server in interactive mode (prints the Expo Go QR code):

   ```sh
   cd apps/mobile && npx expo start --port 8083 --clear
   ```

   Wait for the first web compile (1-3 minutes) after opening http://localhost:8083.

5. iPhone: install or update **Expo Go** from the App Store, join the same Wi-Fi as the Mac, scan
   the terminal QR code with the Camera app (or enter `exp://<LAN-IP>:8083` in Expo Go). Allow
   Node's incoming connections on the Mac if macOS asks.

"DEV SIGN-IN as `<user>`" below means: on the login screen, tap the `<user>` chip in the DEV
SIGN-IN box (or type the name), then tap **Dev sign in**.

## 1. Real Google login on web (VAL-MANUAL-GOOGLE-001)

The web app runs the Google authorization-code request with PKCE. After consent, Google redirects
back to `http://localhost:8083` with a code, the app sends `{code, codeVerifier, redirectUri}` to
the backend `POST /auth/google/code`, and the backend exchanges the code with Google using the
server-only client secret.

Prerequisites:

1. In Google Cloud Console → **APIs & Services → Credentials**, open the Web-application client
   `686477747885-1km1tuodinj4bp2vuhher7v8lo95rr7r.apps.googleusercontent.com` and confirm
   `http://localhost:8083` is in both **Authorized JavaScript origins** and **Authorized redirect
   URIs** (the local web app moved from 8081 to 8083; add the new origin if only 8081 is listed).
   The backend accepts this redirect by default (`GOOGLE_REDIRECT_ALLOWLIST`). If the OAuth consent screen is in testing mode, add your Google account as a test user.
2. Copy the client secret into the **root** `.env` (gitignored) as
   `GOOGLE_CLIENT_SECRET=<secret>`. Do not put it in `apps/mobile/.env`, do not commit it, and do
   not paste it in chat.
3. Reload the api so it reads the new value, then check it is up:

   ```sh
   docker compose up -d --force-recreate api
   i=0; until curl -sf localhost:3100/health; do i=$((i+1)); if [ "$i" -ge 60 ]; then echo "API not healthy after 60 s; run: docker compose logs api" >&2; break; fi; sleep 1; done; echo
   ```

   Continue once it prints `{"status":"ok","database":"up"}`.

Steps:

1. In a private/incognito Mac browser window, open http://localhost:8083. If you are already
   signed in, go to **Settings → LOGOUT** first.
2. Click **Continue with Google**.
3. Choose your Google account and approve the consent screen (`openid`, `email`, `profile`).
4. The browser returns to http://localhost:8083 and lands on the **Feed** tab, signed in. A new
   account shows the empty-feed welcome message, which is expected.
5. Open the **Me** tab and check that your Google name and picture appear.

Evidence to capture:

- Your confirmation that you landed signed in (a screenshot of the Feed or Me tab is enough).
- The provisioned user row (shows no secrets):

  ```sh
  docker compose exec -T db psql -U sharkulator -d sharkulator_dev -c \
    "select username, email, email_verified, first_name, last_name, created_at, updated_at from users where google_sub not like 'dev|%' order by updated_at desc limit 3;"
  ```

- Optional: in the browser devtools Network tab, `POST /auth/google/code` returned 200 and no
  request went from the page to `oauth2.googleapis.com/token`.

If it fails: an error banner under the Google button with a 503 means the secret is unset or the
api was not recreated; 400 means the redirect URI is not allowlisted; 401 means Google rejected
the code (start again from step 2). `docker compose logs api` shows the status without any
secrets.

## 2. Two-device QR game (VAL-MANUAL-QR-001)

The winner shows a QR code on the Mac browser; the loser scans it with the iPhone camera in Expo
Go and submits the game. Use seeded users: **dev-alex** wins on the Mac, **dev-sam** loses on
the iPhone.

Steps:

1. Record the starting state, so the change is visible afterwards. The commands mint a dev token
   in a shell variable and never print it:

   ```sh
   TOKEN=$(curl -s -X POST localhost:3100/auth/dev-token -H 'content-type: application/json' -H "x-dev-auth: $(grep '^DEV_AUTH_SECRET=' .env | cut -d= -f2)" -d '{"username":"dev-sam"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
   curl -s "localhost:3100/stats?userName=dev-sam&tournamentName=officebabyfoot" -H "authorization: Bearer $TOKEN" \
     | node -pe 'const s = JSON.parse(require("fs").readFileSync(0)); JSON.stringify({score: s.score, gameCount: s.gameCount})'
   for pair in dev-alex:dev-sam dev-sam:dev-alex; do
     curl -s "localhost:3100/rivalry?userName=${pair%%:*}&rivalName=${pair#*:}&tournamentName=officebabyfoot" -H "authorization: Bearer $TOKEN" \
       | node -pe 'const r = JSON.parse(require("fs").readFileSync(0)); r.user ? JSON.stringify({user: r.user.username, rival: r.rival.username, score: r.score, gameCount: r.gameCount, winCount: r.winCount, loseCount: r.loseCount}) : JSON.stringify(r)'
   done
   ```

   Write down dev-sam's `score` and `gameCount` (first line) and both rivalry lines:
   `dev-alex → dev-sam` and `dev-sam → dev-alex`. The two rivalry `score` values are opposites
   (for example `42` and `-42`) and share the same `gameCount`. If the token expires (15 minutes),
   run the `TOKEN=` line again.

2. **Mac browser** (http://localhost:8083): sign out if needed, then **DEV SIGN-IN** as `dev-alex`.
3. **iPhone (Expo Go)**: **DEV SIGN-IN** as `dev-sam`. Open the **Feed** tab and leave it there
   for a moment so its data loads.
4. Baseline rivalry on both devices. On each device, in **YOUR HISTORY** on the **Feed** tab, tap
   the most recent Office Babyfoot game between dev-alex and dev-sam to expand it. Its **RIVALRY**
   section shows the signed-in user on the left: on the Mac `dev-alex` vs `dev-sam`, on the iPhone
   `dev-sam` vs `dev-alex`. Note **Total Points** and **Game Count** on each device. They match the
   step 1 rivalry lines for that direction (the Mac's left Total Points is dev-alex's `score`, the
   iPhone's left Total Points is dev-sam's `score`). Tap the row again to collapse it.
5. Mac: open **Add Game** → **WON**. Press **EDIT** and pick **Office Babyfoot**. A QR code
   appears.
6. iPhone: open **Add Game** → **LOST**. Press **EDIT** and pick **Office Babyfoot** (both sides
   must use the same tournament, or the scan is rejected). Allow camera access when asked.
7. iPhone: point the camera at the QR code on the Mac screen. `dev-alex` appears on the winner
   side and `dev-sam` on the loser side.
8. iPhone: tap **All good**. The dialog says "All Good ?" and "Games can't be deleted or edited
   once submitted." Tap **Submit**.
9. iPhone: the **RESULTS** screen shows the game with the Elo change (call it `x` points). Tap
   **Back to feed**: the new game is at the top of **YOUR HISTORY** and the Office Babyfoot card
   shows the new score. Tap the new game to expand its **RIVALRY** section (`dev-sam` vs
   `dev-alex`): **Game Count** is one higher than in step 4 and the left **Total Points** is
   `x` lower; the right column shows the same number with the opposite sign.
10. Mac: the browser is still on the **Winner** screen, which has no tab bar. Open the Feed in one
    of two ways:
    - press the browser's **Back** button once to return to the **Add Game** tab (the tab bar is
      visible again), then click the **Feed** tab; or
    - type http://localhost:8083/feed in the address bar and press Enter.

    Do not just reload: a reload stays on the Winner screen.

    The new game appears at the top of dev-alex's **YOUR HISTORY** with the updated Office
    Babyfoot score. Click the new game to expand its **RIVALRY** section (`dev-alex` vs
    `dev-sam`): **Game Count** is one higher than in step 4 and the left **Total Points** is `x`
    higher; the right column shows the same number with the opposite sign.

Evidence to capture:

- Your confirmation of steps 7-10, including the step 4 baseline and the step 9 and 10 RIVALRY
  values on each device (optional screenshots of the iPhone result screen, both feeds, and both
  expanded RIVALRY sections).
- Re-run the step 1 commands (refresh `TOKEN` if more than 15 minutes have passed). Compared with
  the baseline: dev-sam's `gameCount` is one higher and `score` lower; in both rivalry lines
  `gameCount` is one higher; `dev-alex → dev-sam` has `score` up by `x` and `winCount` up by
  one; `dev-sam → dev-alex` has `score` down by `x` and `loseCount` up by one; the two scores
  are still opposites. Then the latest game rows:

  ```sh
  docker compose exec -T db psql -U sharkulator -d sharkulator_dev -c \
    "select g.date, u.username, o.result, o.score_value from games g join tournaments t on t.id = g.tournament_id join outcomes o on o.game_id = g.id join users u on u.id = o.user_id where t.name = 'officebabyfoot' order by g.date desc limit 2;"
  ```

  Expect two rows from a moment ago: `dev-alex WIN +x` and `dev-sam LOSS -x`.

- Run `unset TOKEN` when you are done.

If the scan does nothing: check that both screens show **Office Babyfoot**, raise the Mac screen
brightness, and hold the phone 20-40 cm away. Non-production builds also print the payload under
the QR code; it can be pasted into the scanner's **DEV: paste a QR code payload** field as a last
resort, but that does not count as the camera check.

## 3. Native pull-to-refresh on the feed (VAL-MOBILE-001, native portion)

The web build cannot exercise pull-to-refresh, so this gesture is confirmed once on the iPhone.
The trick is to change data from the Mac while the phone stays on the Feed tab, so only the pull
can bring the change in.

Steps:

1. iPhone: signed in as `dev-sam`, open the **Feed** tab and note the top game in **YOUR
   HISTORY**. Keep the app in the foreground and do not switch tabs.
2. Mac: submit a game in which dev-sam loses to dev-alex (dev-sam is the submitter, as the API
   requires):

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3100/tournaments/officebabyfoot/games \
     -H 'content-type: application/json' \
     -H "authorization: Bearer $(curl -s -X POST localhost:3100/auth/dev-token -H 'content-type: application/json' -H "x-dev-auth: $(grep '^DEV_AUTH_SECRET=' .env | cut -d= -f2)" -d '{"username":"dev-sam"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')" \
     -d '{"outcomes":[{"username":"dev-alex","result":"WIN"},{"username":"dev-sam","result":"LOSS"}]}'
   ```

   Expect `201`. The phone does not change yet.

3. iPhone: pull the feed down from the top until the spinner appears, then release.
4. The spinner disappears and the new game (dev-alex beat dev-sam, a few seconds ago) is now at
   the top of **YOUR HISTORY**, with the Office Babyfoot score updated.

Evidence to capture:

- Your confirmation that the pull showed the spinner and brought in the new game (optional
  screen recording or before/after screenshots).
- The `201` from step 2.

## 4. Push on a real phone

Remote push does not work in Expo Go (since SDK 53 it is unavailable in Expo Go on Android, and
this app registers a device only when its build has an EAS project ID). Use a development build.

Prerequisites (once; details in
[Push notifications on a real phone](apps/mobile/README.md#push-notifications-on-a-real-phone)):

1. An Expo account and EAS project: from `apps/mobile`, run `npx eas-cli@latest init`, which writes
   `expo.extra.eas.projectId` into `app.json`. Keep that change if you want push in your builds.
2. Push credentials: iOS needs a paid Apple Developer account (accept the push notification
   setup when EAS CLI asks, or run `npx eas-cli@latest credentials`); Android needs FCM V1
   credentials uploaded to the Expo project and `expo.android.googleServicesFile` in `app.json`.
3. A development build installed on a physical phone: `npx expo install expo-dev-client`, then
   `npx eas-cli@latest build --profile development --platform ios` (or `android`), or
   `npx expo run:ios --device` / `npx expo run:android`.
4. `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3100` in `apps/mobile/.env` (Preparation step 3), then
   `cd apps/mobile && npx expo start --dev-client --port 8083 --clear` and open the project from
   the development build.
5. A shell helper that mints a dev token without printing it (re-run it after 15 minutes):

   ```sh
   tok() { curl -s -X POST localhost:3100/auth/dev-token -H 'content-type: application/json' -H "x-dev-auth: $(grep '^DEV_AUTH_SECRET=' .env | cut -d= -f2)" -d "{\"username\":\"$1\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken'; }
   ```

Steps:

1. Phone: **DEV SIGN-IN** as `dev-sam` and allow notifications when asked.
2. Mac: confirm the device registered (prints no token):

   ```sh
   docker compose exec -T db psql -U sharkulator -d sharkulator_dev -c \
     "select u.username, d.platform, d.disabled_at, d.last_seen_at from push_devices d join users u on u.id = d.user_id where u.username = 'dev-sam';"
   ```

   Expect one row with your platform (`IOS` or `ANDROID`) and an empty `disabled_at`.

3. **App running, in the background**: press the home button, then record a game from the Mac
   (dev-sam loses to dev-alex):

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3100/tournaments/officebabyfoot/games \
     -H 'content-type: application/json' -H "authorization: Bearer $(tok dev-sam)" \
     -d '{"outcomes":[{"username":"dev-alex","result":"WIN"},{"username":"dev-sam","result":"LOSS"}]}'
   ```

   Expect `201` and, within a few seconds, a push "You lost in Office Babyfoot". Tap it: the app
   opens that game's detail screen.

4. **App in the foreground**: stay on the Feed and record another game with the same command. A
   banner appears and the Feed shows the new game without a pull. The bell count goes up.
5. **Cold start**: force-quit the app (swipe it away). Send dev-sam a challenge from the Mac:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3100/challenges \
     -H 'content-type: application/json' -H "authorization: Bearer $(tok dev-alex)" \
     -d '{"tournamentName":"chessclub","opponentUsername":"dev-sam"}'
   ```

   Expect `201` (a `400` means an active dev-alex/dev-sam challenge already exists there; use
   another open tournament such as `lunchdarts`). Tap the push: the app launches, signs in from
   the stored session and opens that challenge's detail screen (not just the Feed).

6. **Push-only preferences**: in **Settings → Notifications**, turn off **Games**. Record a game
   with the step 3 command. No push arrives, but the inbox (bell on the Feed) still lists the new
   "game recorded" entry. Turn **Games** back on; the next game pushes again.
7. **Logout unregisters this phone**: **Settings → LOGOUT**. Re-run the step 2 query: the row now
   has a `disabled_at` time. Record a game with the step 3 command: no push arrives.

Expected outcome: pushes arrive on the phone, taps open the right screen both while the app is
running and from a cold start, a category turned off stops only its push, and logout stops push
to that phone.

Evidence to capture: screenshots of the received pushes and the opened game and challenge
screens, the step 2 and step 7 query output, the HTTP codes, and a note of the platform and build
type you used. Do not share push tokens. If no push arrives, check `docker compose logs api` for
push errors and that the build has the project ID (the app logs "Push disabled: no EAS projectId
in the app config." otherwise).

## 5. Real Google claim with a brand-new account

Automation simulated Google's identity for claims. This check uses real Google consent and a
Google account that has never signed in to this Sharkulator database.

Prerequisites: section 1 prerequisites (client secret, `http://localhost:8083` registered in the
Google Console), and a brand-new Google account (or one never used with this database) added as
a test user if the consent screen is in testing mode. Also have an existing Sharkulator Google
account for the negative check (the one from section 1).

Steps:

1. Mac browser: **DEV SIGN-IN** as `dev-alex`. Open **Add Game** → **LOST**. Pick the tournament
   first: tap **EDIT** next to the tournament at the top (**Select a tournament** if none is
   shown) and choose **Shark Tank Cup**. The **NO QR CODE?** section now says "Shark Tank
   tournament: … New players added by name join the group's unclaimed players." Only then, with
   **Add as winner** selected, type a new name in **New player name** (for example `Claim Test`)
   and tap **Add player by name**. Then **Review game** → **Confirm game**. Copy the new player's
   claim link from **Settings → Invited players**.

   Keep this order. Picking a tournament clears the players already in the draft (so **Review
   game** stays disabled), and a player added by name joins the roster of the group whose
   tournament is selected at that moment. If you added the player before picking Shark Tank Cup,
   start again with a different new name: that player is not on the Shark Tank roster, so
   claiming it would not grant group access.

2. In a private/incognito window, open the claim link. The page shows the player's name and game
   history, and no private group details.
3. Negative check first: click **Claim with Google** and choose your **existing** Sharkulator
   account. Expected: "This Google account already has a Sharkulator profile, so it cannot claim
   this player. Nothing was changed." Close the private window.
4. Open the same link again in a new private window (it must still work), click
   **Claim with Google**, and choose the **brand-new** account.
5. Expected: you land signed in as the claimed player. **Me** shows the inherited game and rating;
   **Settings → Groups** lists **Shark Tank** (you are a member because the player was on its
   roster), and the Shark Tank Cup leaderboard is visible.
6. As `dev-alex` (normal window), the bell shows "Invite accepted", and **Settings → Invited
   players** shows the player as claimed. Opening the link again shows that it can't be used.
7. Optional native continuation: native Google sign-in needs a Google OAuth client that accepts
   the native redirect `com.elo.sharkulator:/oauthredirect` and whose code the backend can
   exchange; the current setup has only the web client, so Expo Go and an unconfigured
   development build cannot finish Google sign-in. If you configure it, repeat steps 1-5 with a
   second new account: open the claim link on the phone, tap **Open in app**, claim with Google in
   the development build, and confirm the app returns to the claimed profile with group access.
   Otherwise record "native Google claim not configured".

Evidence to capture: screenshots of the claim page, the existing-account error, the signed-in
claimed profile and its group membership, plus this query (no secrets):

```sh
docker compose exec -T db psql -U sharkulator -d sharkulator_dev -c \
  "select username, account_type, claimed_at, email_verified from users where claimed_at is not null order by claimed_at desc limit 3;"
```

## 6. Native share sheet

Steps (Expo Go or a development build, signed in as `dev-sam`):

1. Open a game from **YOUR HISTORY** on the Feed. Under **Share result**, read the disclosure,
   then tap **Share result**.
2. Expected: the system share sheet opens with the result text and a link
   `<PUBLIC_API_URL>/s/<token>`. Share it to Notes or to yourself.
3. Tap **Revoke link**; the screen says the link no longer shows the result.

Locally the link uses `http://localhost:3100`, which the phone cannot open; the sheet itself is
what this section checks. Section 7 checks the link after you deploy.

Evidence to capture: a screenshot of the open share sheet (hide the token part of the link).

## 7. Messenger link preview after deploy

Only after you deploy the API to `https://shrkltr-api.wtchthfck.com` and the web app to
`https://shrkltr.wtchthfck.com` with the production settings from the
[README deployment notes](README.md#production-deployment-notes). Local checks of the HTML and PNG
do not prove a messenger preview.

Steps:

1. In the production app, open one of your games and share it (web: **Share result** or
   **Copy link**). The link starts with `https://shrkltr-api.wtchthfck.com/s/`.
2. Paste it into a WhatsApp or iMessage chat (to yourself is fine) and wait for the preview.
3. Expected: a preview card with the result title and the 1200×630 Sharkulator image (players,
   result, Elo changes, sport). Tapping it opens the share page, whose **Open Sharkulator** button
   leads to `https://shrkltr.wtchthfck.com/games/<id>`.
4. Revoke the link in the app, then open it in a browser: it answers 404 (not found). Messengers
   cache previews, so an already-sent preview may stay visible.

Evidence to capture: screenshots of the preview in WhatsApp or iMessage and of the revoked link
in a browser.

## Cleanup

- Set `EXPO_PUBLIC_API_URL` back to `http://localhost:3100` in `apps/mobile/.env` if you changed
  it, and stop the Expo dev server (Ctrl+C).
- The games created here stay in the dev database. To start over, wait for the api before
  seeding:

  ```sh
  docker compose down -v
  docker compose up -d
  i=0; until curl -sf localhost:3100/health; do i=$((i+1)); if [ "$i" -ge 60 ]; then echo "API not healthy after 60 s; run: docker compose logs api" >&2; break; fi; sleep 1; done; echo
  [ "$i" -lt 60 ] && npm run seed -w apps/backend
  ```

- `GOOGLE_CLIENT_SECRET` can stay in the root `.env` (it is gitignored); remove it if you prefer.
