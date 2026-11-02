# Device checklist

Manual checks that automation cannot do: real Google consent, a camera scan between two devices,
and the native pull-to-refresh gesture. Each section lists exact steps and the evidence to send
back. Commands run from the repo root (`/Users/cp/code/sharkulator`) on the Mac.

| #   | Check                              | Assertion                       | Devices                        |
| --- | ---------------------------------- | ------------------------------- | ------------------------------ |
| 1   | Real Google login on web           | VAL-MANUAL-GOOGLE-001           | Mac browser                    |
| 2   | Two-device QR game                 | VAL-MANUAL-QR-001               | Mac browser + iPhone (Expo Go) |
| 3   | Native pull-to-refresh on the feed | VAL-MOBILE-001 (native portion) | iPhone (Expo Go)               |

Never paste secrets, tokens, or `.env` contents into chat or screenshots.

## 0. Preparation (once)

1. Start the backend and load demo data:

   ```sh
   docker compose up -d
   curl -s localhost:3100/health        # expect {"status":"ok","database":"up"}
   npm run seed -w apps/backend         # idempotent
   ```

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
   cd apps/mobile && npx expo start --port 8081 --clear
   ```

   Wait for the first web compile (1-3 minutes) after opening http://localhost:8081.

5. iPhone: install or update **Expo Go** from the App Store, join the same Wi-Fi as the Mac, scan
   the terminal QR code with the Camera app (or enter `exp://<LAN-IP>:8081` in Expo Go). Allow
   Node's incoming connections on the Mac if macOS asks.

"DEV SIGN-IN as `<user>`" below means: on the login screen, tap the `<user>` chip in the DEV
SIGN-IN box (or type the name), then tap **Dev sign in**.

## 1. Real Google login on web (VAL-MANUAL-GOOGLE-001)

The web app runs the Google authorization-code request with PKCE. After consent, Google redirects
back to `http://localhost:8081` with a code, the app sends `{code, codeVerifier, redirectUri}` to
the backend `POST /auth/google/code`, and the backend exchanges the code with Google using the
server-only client secret.

Prerequisites:

1. In Google Cloud Console → **APIs & Services → Credentials**, open the Web-application client
   `686477747885-1km1tuodinj4bp2vuhher7v8lo95rr7r.apps.googleusercontent.com` and confirm
   `http://localhost:8081` is in both **Authorized JavaScript origins** and **Authorized redirect
   URIs**. If the OAuth consent screen is in testing mode, add your Google account as a test user.
2. Copy the client secret into the **root** `.env` (gitignored) as
   `GOOGLE_CLIENT_SECRET=<secret>`. Do not put it in `apps/mobile/.env`, do not commit it, and do
   not paste it in chat.
3. Reload the api so it reads the new value, then check it is up:

   ```sh
   docker compose up -d --force-recreate api
   curl -s localhost:3100/health
   ```

Steps:

1. In a private/incognito Mac browser window, open http://localhost:8081. If you are already
   signed in, go to **Settings → LOGOUT** first.
2. Click **Continue with Google**.
3. Choose your Google account and approve the consent screen (`openid`, `email`, `profile`).
4. The browser returns to http://localhost:8081 and lands on the **Feed** tab, signed in. A new
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

1. Note the starting state, so the change is visible afterwards:

   ```sh
   curl -s "localhost:3100/stats?userName=dev-sam&tournamentName=officebabyfoot" \
     -H "authorization: Bearer $(curl -s -X POST localhost:3100/auth/dev-token -H 'content-type: application/json' -H "x-dev-auth: $(grep '^DEV_AUTH_SECRET=' .env | cut -d= -f2)" -d '{"username":"dev-sam"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')" \
     | node -pe 'const s = JSON.parse(require("fs").readFileSync(0)); JSON.stringify({score: s.score, gameCount: s.gameCount})'
   ```

   Write down `score` and `gameCount` (no tokens are printed).

2. **Mac browser** (http://localhost:8081): sign out if needed, then **DEV SIGN-IN** as `dev-alex`.
3. **iPhone (Expo Go)**: **DEV SIGN-IN** as `dev-sam`. Open the **Feed** tab and leave it there
   for a moment so its data loads.
4. Mac: open **Add Game** → **WON**. Press **EDIT** and pick **Office Babyfoot**. A QR code
   appears.
5. iPhone: open **Add Game** → **LOST**. Press **EDIT** and pick **Office Babyfoot** (both sides
   must use the same tournament, or the scan is rejected). Allow camera access when asked.
6. iPhone: point the camera at the QR code on the Mac screen. `dev-alex` appears on the winner
   side and `dev-sam` on the loser side.
7. iPhone: tap **All good**. The dialog says "All Good ?" and "Games can't be deleted or edited
   once submitted." Tap **Submit**.
8. iPhone: the **RESULTS** screen shows the game with the Elo change. Tap **Back to feed**: the
   new game is at the top of **YOUR HISTORY** and the Office Babyfoot card shows the new score.
9. Mac: tap the **Feed** tab (or reload the page). The new game appears at the top of dev-alex's
   history with the updated Office Babyfoot score.

Evidence to capture:

- Your confirmation of steps 6-9 (optional screenshots of the iPhone result screen and both
  feeds).
- The changed stats (re-run the step 1 command: `gameCount` is one higher and `score` lower),
  plus the latest game rows:

  ```sh
  docker compose exec -T db psql -U sharkulator -d sharkulator_dev -c \
    "select g.date, u.username, o.result, o.score_value from games g join tournaments t on t.id = g.tournament_id join outcomes o on o.game_id = g.id join users u on u.id = o.user_id where t.name = 'officebabyfoot' order by g.date desc limit 2;"
  ```

  Expect two rows from a moment ago: `dev-alex WIN +x` and `dev-sam LOSS -x`.

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

## Cleanup

- Set `EXPO_PUBLIC_API_URL` back to `http://localhost:3100` in `apps/mobile/.env` if you changed
  it, and stop the Expo dev server (Ctrl+C).
- The games created here stay in the dev database. To start over: `docker compose down -v`,
  `docker compose up -d`, `npm run seed -w apps/backend`.
- `GOOGLE_CLIENT_SECRET` can stay in the root `.env` (it is gitignored); remove it if you prefer.
