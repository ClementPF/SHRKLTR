# Sharkulator

Multi-sport tournament tracker with Elo ratings. This monorepo replaces the legacy
`SHRKLTR-BCKND` (Spring Boot) and `elo` (Expo SDK 33) projects, which stay in this folder as
read-only, gitignored references.

## Layout

- `apps/backend`: Fastify + Zod + Drizzle API on PostgreSQL 17 ([README](apps/backend/README.md))
- `apps/mobile`: Expo SDK 58 app for iOS, Android, and web ([README](apps/mobile/README.md))
- `docker-compose.yml`: `db` (Postgres, host port 5433) and `api` (hot reload, port 3100)
- `Dockerfile`: `dev` target for compose, `prod` target for a slim production image
- [`DEVICE-CHECKLIST.md`](DEVICE-CHECKLIST.md): manual checks automation cannot do: real Google
  login, the two-device QR flow, native pull-to-refresh, push on a real phone, a real Google claim
  with a brand-new account, native sharing, and messenger link previews after you deploy

## Prerequisites

- Node 24+ and npm 11 (npm workspaces; do not use pnpm, yarn, or bun here)
- Docker Desktop (Compose v2)
- For device testing: an iPhone with Expo Go on the same Wi-Fi network as the Mac

Ports used: 5433 (Postgres), 3100 (API), 8083 (Expo dev server / web app). The local web origin
`http://localhost:8083` is the default of `PUBLIC_WEB_URL`, `CORS_ORIGINS`,
`GOOGLE_REDIRECT_ALLOWLIST` and `EXPO_PUBLIC_WEB_URL`; if you run Expo on another port, change all
four together.

## Quick start

From the repo root:

```sh
npm install
cp .env.example .env                       # then generate the three secrets (see below)
cp apps/mobile/.env.example apps/mobile/.env
docker compose up -d                       # db + api; migrations run on api boot
i=0; until curl -sf localhost:3100/health; do i=$((i+1)); if [ "$i" -ge 60 ]; then echo "API not healthy after 60 s; run: docker compose logs api" >&2; break; fi; sleep 1; done; echo
[ "$i" -lt 60 ] && npm run seed -w apps/backend   # idempotent demo data, only once the api is up
cd apps/mobile && CI=true npx expo start --port 8083
```

The wait line polls `/health` once a second for up to 60 seconds and prints
`{"status":"ok","database":"up"}` when the api is ready. The api applies migrations before it
answers, so seeding earlier can fail with "relation does not exist". If the wait gives up it prints
`API not healthy after 60 s` and the seed line does nothing; check `docker compose logs api`, fix
the cause, and run both lines again.

Open http://localhost:8083, then use **DEV SIGN-IN** (for example `dev-alex`) to see the seeded
feed. The first web compile takes 1-3 minutes. See [Local demo data](#local-demo-data) for what the
seed creates.

Generate each secret in `.env` (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DEV_AUTH_SECRET`)
with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then copy the `DEV_AUTH_SECRET` value into `apps/mobile/.env` as `EXPO_PUBLIC_DEV_AUTH` to enable
the dev sign-in control. The mission `init.sh` script generates the root secrets for you but
leaves `EXPO_PUBLIC_DEV_AUTH` blank.

## Local demo data

`npm run seed -w apps/backend` loads demo data into `sharkulator_dev` (host default
`localhost:5433`; override with `DATABASE_URL`). It is idempotent: a rerun adds only what is
missing, never replays games, never resets a role, claim, invite, challenge or read state you
changed while testing, never registers a push device and never sends a push. It refuses to run
with `APP_ENV=production`.

| Fixture          | What you get                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users            | `dev-alex`, `dev-sam`, `dev-jordan`, `dev-taylor`, `dev-morgan` (use **DEV SIGN-IN**)                                                                                                                                                              |
| Open tournaments | Office Babyfoot, Friday Ping Pong, Chess Club, Lunch Darts with history, ratings and rivalries (the QR checklist uses Office Babyfoot)                                                                                                             |
| Group            | **Shark Tank**: `dev-alex` OWNER, `dev-sam` ADMIN, `dev-jordan` MEMBER, the members-only tournament **Shark Tank Cup**, and the unclaimed player `guest-robin` on its roster. `dev-taylor` and `dev-morgan` are not members, so they cannot see it |
| Invited players  | Placeholders created by `dev-alex`, one per claim-link state: `guest-riley` and `guest-robin` ACTIVE, `guest-casey` EXPIRED, `guest-jamie` REVOKED, `guest-quinn` CLAIMED                                                                          |
| Challenges       | PENDING (dev-morgan → dev-alex, and dev-alex → dev-sam in Shark Tank Cup), ACCEPTED (dev-alex vs dev-jordan), DECLINED (dev-alex → dev-morgan), COMPLETED (dev-sam vs dev-alex, linked to its game), EXPIRED (dev-taylor → dev-alex)               |
| Inbox            | A `game_recorded` entry per participant of every demo game (older than 48 hours: read; newer: unread), challenge events for the challenges above, and dev-alex's "player claimed" entry                                                            |
| Badges           | Historical badges from the silent achievements backfill (first win, games played, win streaks, explorer). Giant killer, challenge, group and claim badges are only earned live                                                                     |

The seed ends by printing the LOCAL ONLY claim links, the Shark Tank group invite link and its
short code. They use fixed dev tokens, so they are the same on every machine and work only against
a local database. Each line shows the link's current state: `ACTIVE`, `EXPIRED`, `REVOKED`,
`CLAIMED`, or `REPLACED` when you reissued it in the app (the seed never rotates it back, so a
replaced or revoked fixture link stays dead until you start over from an empty database).

The printed links use the same web origin as the links the api issues: `PUBLIC_WEB_URL` from the
shell if set, otherwise the one in the root `.env` (only that variable is read from the file),
otherwise the default `http://localhost:8083`. For example
`PUBLIC_WEB_URL=http://192.168.1.21:8083 npm run seed -w apps/backend` prints LAN links.

To try the fixtures: open a printed claim link in a signed-out browser to see the claim page;
sign in as `dev-taylor` and open the group link or enter the code under **Groups → Join with a
code** to join Shark Tank; open **Feed → Challenges** as `dev-alex` to see every challenge state.

### Starting over from an empty database

```sh
docker compose down -v      # removes the containers and the sharkulator_pgdata volume
docker compose up -d        # fresh db; the api applies every migration on boot
i=0; until curl -sf localhost:3100/health; do i=$((i+1)); if [ "$i" -ge 60 ]; then echo "API not healthy after 60 s; run: docker compose logs api" >&2; break; fi; sleep 1; done; echo
[ "$i" -lt 60 ] && npm run seed -w apps/backend
```

The api usually answers `/health` within about 10 seconds. The wait line is the same bounded
readiness check as in the quick start: never seed before it prints the healthy response.

## Day-to-day commands

| What                               | Command                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| Start db + api                     | `docker compose up -d`                                                                 |
| Stop db + api                      | `docker compose stop`                                                                  |
| API logs                           | `docker compose logs -f api`                                                           |
| Seed demo data                     | `npm run seed -w apps/backend`                                                         |
| Expo dev server (web + Expo Go)    | `cd apps/mobile && CI=true npx expo start --port 8083`                                 |
| Award historical badges            | `npm run achievements:backfill -w apps/backend [-- --dry-run]`                         |
| Backend tests (needs `db` running) | `npm run test -w apps/backend`                                                         |
| Mobile tests                       | `CI=true npm run test -w apps/mobile`                                                  |
| All tests                          | `npm run test`                                                                         |
| Typecheck both workspaces          | `npm run typecheck`                                                                    |
| Lint + Prettier check              | `npm run lint`                                                                         |
| Format                             | `npm run format`                                                                       |
| Generate a migration               | see [apps/backend/README.md](apps/backend/README.md#database-migrations-and-demo-data) |
| Production API image               | `docker build --target prod -t sharkulator-api .`                                      |

`CI=true` stops Expo from opening a browser and runs jest once instead of in watch mode.

## API docs

- Swagger UI: http://localhost:3100/docs
- OpenAPI JSON: http://localhost:3100/docs/json
- Health: http://localhost:3100/health

## Environment variables

### Root `.env` (backend, gitignored; template in `.env.example`)

| Variable                    | Required         | Default / example                                                    | Notes                                                                                                                                                            |
| --------------------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | no               | `3100`                                                               | Compose pins it to 3100.                                                                                                                                         |
| `HOST`                      | no               | `0.0.0.0`                                                            |                                                                                                                                                                  |
| `APP_ENV`                   | no               | `development`                                                        | `development`, `test`, or `production`. Production disables `/auth/dev-token`.                                                                                   |
| `DATABASE_URL`              | yes              | `postgres://sharkulator:sharkulator@db:5432/sharkulator_dev`         | Compose-internal host. Host tools use `localhost:5433`.                                                                                                          |
| `TEST_DATABASE_URL`         | for tests        | `postgres://sharkulator:sharkulator@localhost:5433/sharkulator_test` | Used by host-run vitest.                                                                                                                                         |
| `JWT_ACCESS_SECRET`         | yes              | 32-byte hex                                                          | Signs 15-minute access tokens.                                                                                                                                   |
| `JWT_REFRESH_SECRET`        | yes              | 32-byte hex                                                          | Signs 30-day refresh tokens.                                                                                                                                     |
| `DEV_AUTH_SECRET`           | yes              | 32-byte hex                                                          | `x-dev-auth` header value for `POST /auth/dev-token`.                                                                                                            |
| `GOOGLE_CLIENT_ID`          | yes              | `686477747885-…apps.googleusercontent.com`                           | Google Web-application client ID (public). Expected `aud` of Google ID tokens.                                                                                   |
| `GOOGLE_CLIENT_SECRET`      | for Google login | unset                                                                | Web-application client **secret**. Server-only; see below.                                                                                                       |
| `GOOGLE_JWKS_URL`           | no               | `https://www.googleapis.com/oauth2/v3/certs`                         | Overridden in tests.                                                                                                                                             |
| `GOOGLE_TOKEN_URL`          | no               | `https://oauth2.googleapis.com/token`                                | Overridden in tests.                                                                                                                                             |
| `GOOGLE_REDIRECT_ALLOWLIST` | no               | `http://localhost:8083`                                              | Comma-separated exact redirect URIs accepted by `POST /auth/google/code`. Must contain `EXPO_PUBLIC_WEB_URL`.                                                    |
| `PUSH_URL`                  | no               | `https://exp.host/--/api/v2/push/send`                               | Expo push API; point at a local collector when testing.                                                                                                          |
| `PUSH_TIMEOUT_MS`           | no               | `5000`                                                               | Upper bound for one push request. Push runs after a save commits and never fails it.                                                                             |
| `EXPO_ACCESS_TOKEN`         | no               | unset                                                                | Server-only Expo access token, needed only if you turn on enhanced push security in your Expo project. Never in `EXPO_PUBLIC_*`.                                 |
| `PUBLIC_API_URL`            | no               | `http://localhost:3100`                                              | Canonical API origin for share links. Production `https://shrkltr-api.wtchthfck.com`.                                                                            |
| `PUBLIC_WEB_URL`            | no               | `http://localhost:8083`                                              | Web app origin for claim/invite/join links and the share page button. Production `https://shrkltr.wtchthfck.com`. The seed prints its fixture links with it too. |
| `CORS_ORIGINS`              | no               | `http://localhost:8083`                                              | Comma-separated exact browser origins allowed by CORS; no paths or wildcards. Production `https://shrkltr.wtchthfck.com`.                                        |
| `CLAIM_TTL_DAYS`            | no               | `30`                                                                 | Days before a placeholder claim link expires (1–365).                                                                                                            |
| `GROUP_INVITE_TTL_DAYS`     | no               | `30`                                                                 | Default days before a group invite expires (1–365).                                                                                                              |
| `MAINTENANCE_ENABLED`       | no               | `true`                                                               | Runs the in-process 60-second challenge sweep (expiry and 24-hour reminders); `false` in tests.                                                                  |
| `LOG_LEVEL`                 | no               | `info`                                                               |                                                                                                                                                                  |

### `apps/mobile/.env` (gitignored; template in `apps/mobile/.env.example`)

| Variable                       | Default / example          | Notes                                                                                                                   |
| ------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`          | `http://localhost:3100`    | Use the Mac's LAN address on a physical device (see the mobile README). Production `https://shrkltr-api.wtchthfck.com`. |
| `EXPO_PUBLIC_WEB_URL`          | `http://localhost:8083`    | Origin of the web app; also the Google redirect URI on web. Production `https://shrkltr.wtchthfck.com`.                 |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | same as `GOOGLE_CLIENT_ID` | Public client ID used for the PKCE authorization request.                                                               |
| `EXPO_PUBLIC_ENV`              | `development`              | `production` hides the dev sign-in control.                                                                             |
| `EXPO_PUBLIC_DEV_AUTH`         | empty                      | Set to the root `DEV_AUTH_SECRET` to enable dev sign-in. Dev builds only.                                               |

Every `EXPO_PUBLIC_*` value is inlined into the app bundle. Never put a real secret there
(`GOOGLE_CLIENT_SECRET`, `DEV_AUTH_SECRET` for production, `EXPO_ACCESS_TOKEN` and the JWT secrets
belong only in the root `.env`). Restart the Expo dev server after editing `apps/mobile/.env`.

The Expo push project ID is not an environment variable: real push needs an EAS project ID in
the app config and a development build. See
[Push notifications on a real phone](apps/mobile/README.md#push-notifications-on-a-real-phone).

### Setting up `GOOGLE_CLIENT_SECRET`

Real Google login sends the authorization code to the backend (`POST /auth/google/code`), which
exchanges it with Google using the Web-application client secret. Only the backend ever holds
that secret.

1. In Google Cloud Console, open **APIs & Services → Credentials** and the Web-application OAuth
   client whose ID is `GOOGLE_CLIENT_ID`. Check that `http://localhost:8083` is listed under both
   **Authorized JavaScript origins** and **Authorized redirect URIs**.
2. Copy its client secret and paste it into the **root** `.env` (gitignored):
   `GOOGLE_CLIENT_SECRET=<your secret>`.
3. Recreate the api container so it reloads `.env`: `docker compose up -d --force-recreate api`.
   A `tsx watch` restart does not reload environment variables.

Never commit the secret, never put it in `apps/mobile/.env` or any `EXPO_PUBLIC_*` variable, and
never paste it into chat or logs. While it is unset, `POST /auth/google/code` answers 503 and the
app shows a sign-in error; dev sign-in keeps working.

## Production deployment notes

Production runs on hosting you operate; nothing in this repository deploys it, and local tests
never call the production domains. Production values:

| Where            | Variable                    | Value                                                                |
| ---------------- | --------------------------- | -------------------------------------------------------------------- |
| API (root env)   | `APP_ENV`                   | `production` (removes `/auth/dev-token`; the seed refuses to run)    |
| API              | `PUBLIC_API_URL`            | `https://shrkltr-api.wtchthfck.com`                                  |
| API              | `PUBLIC_WEB_URL`            | `https://shrkltr.wtchthfck.com`                                      |
| API              | `CORS_ORIGINS`              | `https://shrkltr.wtchthfck.com` (exact origin, no trailing slash)    |
| API              | `GOOGLE_REDIRECT_ALLOWLIST` | `https://shrkltr.wtchthfck.com`                                      |
| API              | `GOOGLE_CLIENT_SECRET`      | the Web-application client secret (server only)                      |
| Web/native build | `EXPO_PUBLIC_API_URL`       | `https://shrkltr-api.wtchthfck.com`                                  |
| Web/native build | `EXPO_PUBLIC_WEB_URL`       | `https://shrkltr.wtchthfck.com`                                      |
| Web/native build | `EXPO_PUBLIC_ENV`           | `production` (hides dev sign-in); leave `EXPO_PUBLIC_DEV_AUTH` empty |

Generate fresh `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `DEV_AUTH_SECRET` for production.
Set `EXPO_ACCESS_TOKEN` only if enhanced push security is on in your Expo project. Leave
`PUSH_URL` at its default and `MAINTENANCE_ENABLED=true`.

- **CORS**: the API answers browser requests only from the exact origins in `CORS_ORIGINS`. A
  missing or mistyped entry shows up as network errors in the web app while curl still works.
- **Google Console**: in **APIs & Services → Credentials**, open the Web-application client
  (`GOOGLE_CLIENT_ID`) and add `https://shrkltr.wtchthfck.com` to both **Authorized JavaScript
  origins** and **Authorized redirect URIs**. The web app sends exactly `EXPO_PUBLIC_WEB_URL` as
  its redirect URI, so the Console entry, `EXPO_PUBLIC_WEB_URL` and `GOOGLE_REDIRECT_ALLOWLIST`
  must be the same string (no trailing slash). Keep `http://localhost:8083` too if you sign in
  locally with Google.
- **Share links (`/s/*`) are served by the API**: `https://shrkltr-api.wtchthfck.com/s/<token>`
  returns the public HTML page with Open Graph tags and `/s/<token>.png` the 1200×630 card. Both
  must be reachable over HTTPS without authentication, and `PUBLIC_API_URL` must be the public
  origin (it is never derived from the request `Host`), or link previews break. The page's "Open
  Sharkulator" button points at `PUBLIC_WEB_URL/games/<id>`.
- **Web app hosting**: build with `cd apps/mobile && npx expo export --platform web` (with the
  production `EXPO_PUBLIC_*` values) and host `apps/mobile/dist` as a single-page app: every
  unknown path must fall back to `index.html`, so reloads and shared links such as
  `/invite/claim/<token>`, `/invite/app/<token>`, `/join/<token>`, `/games/<id>` and
  `/challenges/<id>` open the app instead of a 404.
- **Production image**: `docker build --target prod -t sharkulator-api .` builds compiled JS and
  production dependencies only. The image copies the static Inter TTFs and their SIL Open Font
  License (`LICENSE_FONT`) into `dist/assets/fonts` (`tsc` copies no assets and
  `@expo-google-fonts/inter` is a dev dependency), so the share card never downloads a font. `npm
ci` inside the image installs the Linux musl build of `@resvg/resvg-js` for the build
  platform; build on (or with `--platform` for) the architecture you deploy, for example
  `docker build --platform linux/amd64 --target prod …`, and never copy a host `node_modules`
  into it.
- **Database upgrade, in this order**:
  1. Back up the production database (for example
     `pg_dump --format=custom --file=sharkulator-$(date +%F).dump "$DATABASE_URL"`) and check you
     can restore it.
  2. Deploy the new image. The server applies every pending migration in
     `apps/backend/drizzle/` before it listens, then serves `/health`.
  3. Once `/health` answers, award historical badges once with the compiled script in the same
     image and the production `DATABASE_URL`: run
     `node dist/scripts/achievements-backfill.js --dry-run` in a one-off container (for example
     `docker run --rm --env-file <prod env file> sharkulator-api node dist/scripts/achievements-backfill.js --dry-run`)
     to see the counts, then the same command without `--dry-run`. From a source checkout the
     equivalent is `npm run achievements:backfill -w apps/backend -- --dry-run`. It is idempotent
     and silent (no inbox entries, no push), never touches games or ratings, and does not award
     giant killer (historical games have no pre-game ratings) or the challenge, group and claim
     badges.
  4. Never run `npm run seed` against production.
- **Push**: the server needs no extra setting beyond the optional `EXPO_ACCESS_TOKEN`. Phones only
  get push from a build that has your EAS project ID and push credentials; see
  [Push notifications on a real phone](apps/mobile/README.md#push-notifications-on-a-real-phone).
- **After deploying**, run sections 4-7 of [DEVICE-CHECKLIST.md](DEVICE-CHECKLIST.md). Local tests
  cover the share HTML, the PNG and push transport, but not a real phone, a real Google claim or
  a messenger preview.

## Troubleshooting

- **`/health` fails right after `docker compose up -d`**: the api is still applying migrations.
  Use the wait line from the quick start (up to 60 seconds). If it gives up, check
  `docker compose logs api`.
- **Seed fails with "relation ... does not exist"**: it ran before the api finished migrating.
  Run the wait line, then seed again.
- **A backend change is not picked up** (for example a new route returns 404): `tsx watch`
  sometimes misses bind-mount changes on macOS. Run `docker compose restart api`.
- **`.env` change ignored by the api**: recreate it with `docker compose up -d --force-recreate api`.
- **Port 5433, 3100, or 8083 already in use**: find the owner with `lsof -i :<port>`. Stop it
  only if it is yours; otherwise run Expo on another port and change the four web-origin variables
  listed under [Prerequisites](#prerequisites).
  Compose never uses 5432, so another local Postgres does not conflict.
- **Web app stuck on a blank page**: the first Metro compile takes 1-3 minutes. Watch the Expo
  terminal for `Web Bundled`.
- **No DEV SIGN-IN control on the login screen**: `EXPO_PUBLIC_DEV_AUTH` is empty or
  `EXPO_PUBLIC_ENV=production`. Set it and restart Expo with `--clear`.
- **Dev sign-in answers "not found"**: `EXPO_PUBLIC_DEV_AUTH` does not match the root
  `DEV_AUTH_SECRET`, or the user is not seeded (`npm run seed -w apps/backend`).
- **Google sign-in shows an error after consent**: a 503 means `GOOGLE_CLIENT_SECRET` is unset or
  the api was not recreated; a 400 means the redirect URI is not in `GOOGLE_REDIRECT_ALLOWLIST`;
  a 401 means Google rejected the code (retry from the start).
- **Phone shows network errors**: `EXPO_PUBLIC_API_URL` still points at `localhost`. See
  [Expo Go on a device](apps/mobile/README.md#expo-go-on-a-physical-device).
- **Backend tests fail to connect**: start the database first with `docker compose up -d db`.
- **Fresh start**: follow [Starting over from an empty database](#starting-over-from-an-empty-database).
