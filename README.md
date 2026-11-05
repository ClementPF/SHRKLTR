# Sharkulator

Multi-sport tournament tracker with Elo ratings. This monorepo replaces the legacy
`SHRKLTR-BCKND` (Spring Boot) and `elo` (Expo SDK 33) projects, which stay in this folder as
read-only, gitignored references.

## Layout

- `apps/backend`: Fastify + Zod + Drizzle API on PostgreSQL 17 ([README](apps/backend/README.md))
- `apps/mobile`: Expo SDK 58 app for iOS, Android, and web ([README](apps/mobile/README.md))
- `docker-compose.yml`: `db` (Postgres, host port 5433) and `api` (hot reload, port 3100)
- `Dockerfile`: `dev` target for compose, `prod` target for a slim production image
- `DEVICE-CHECKLIST.md`: manual checks for real Google login, the two-device QR flow, and
  native pull-to-refresh

## Prerequisites

- Node 24+ and npm 11 (npm workspaces; do not use pnpm, yarn, or bun here)
- Docker Desktop (Compose v2)
- For device testing: an iPhone with Expo Go on the same Wi-Fi network as the Mac

Ports used: 5433 (Postgres), 3100 (API), 8081 (Expo dev server / web app).

## Quick start

From the repo root:

```sh
npm install
cp .env.example .env                       # then generate the three secrets (see below)
cp apps/mobile/.env.example apps/mobile/.env
docker compose up -d                       # db + api; migrations run on api boot
i=0; until curl -sf localhost:3100/health; do i=$((i+1)); if [ "$i" -ge 60 ]; then echo "API not healthy after 60 s; run: docker compose logs api" >&2; break; fi; sleep 1; done; echo
[ "$i" -lt 60 ] && npm run seed -w apps/backend   # idempotent demo data, only once the api is up
cd apps/mobile && CI=true npx expo start --port 8081
```

The wait line polls `/health` once a second for up to 60 seconds and prints
`{"status":"ok","database":"up"}` when the api is ready. The api applies migrations before it
answers, so seeding earlier can fail with "relation does not exist". If the wait gives up it prints
`API not healthy after 60 s` and the seed line does nothing; check `docker compose logs api`, fix
the cause, and run both lines again.

Open http://localhost:8081, then use **DEV SIGN-IN** (for example `dev-alex`) to see the seeded
feed. The first web compile takes 1-3 minutes.

Generate each secret in `.env` (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DEV_AUTH_SECRET`)
with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then copy the `DEV_AUTH_SECRET` value into `apps/mobile/.env` as `EXPO_PUBLIC_DEV_AUTH` to enable
the dev sign-in control. The mission `init.sh` script generates the root secrets for you but
leaves `EXPO_PUBLIC_DEV_AUTH` blank.

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
| Expo dev server (web + Expo Go)    | `cd apps/mobile && CI=true npx expo start --port 8081`                                 |
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

| Variable                    | Required         | Default / example                                                    | Notes                                                                                   |
| --------------------------- | ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `PORT`                      | no               | `3100`                                                               | Compose pins it to 3100.                                                                |
| `HOST`                      | no               | `0.0.0.0`                                                            |                                                                                         |
| `APP_ENV`                   | no               | `development`                                                        | `development`, `test`, or `production`. Production disables `/auth/dev-token`.          |
| `DATABASE_URL`              | yes              | `postgres://sharkulator:sharkulator@db:5432/sharkulator_dev`         | Compose-internal host. Host tools use `localhost:5433`.                                 |
| `TEST_DATABASE_URL`         | for tests        | `postgres://sharkulator:sharkulator@localhost:5433/sharkulator_test` | Used by host-run vitest.                                                                |
| `JWT_ACCESS_SECRET`         | yes              | 32-byte hex                                                          | Signs 15-minute access tokens.                                                          |
| `JWT_REFRESH_SECRET`        | yes              | 32-byte hex                                                          | Signs 30-day refresh tokens.                                                            |
| `DEV_AUTH_SECRET`           | yes              | 32-byte hex                                                          | `x-dev-auth` header value for `POST /auth/dev-token`.                                   |
| `GOOGLE_CLIENT_ID`          | yes              | `686477747885-…apps.googleusercontent.com`                           | Google Web-application client ID (public). Expected `aud` of Google ID tokens.          |
| `GOOGLE_CLIENT_SECRET`      | for Google login | unset                                                                | Web-application client **secret**. Server-only; see below.                              |
| `GOOGLE_JWKS_URL`           | no               | `https://www.googleapis.com/oauth2/v3/certs`                         | Overridden in tests.                                                                    |
| `GOOGLE_TOKEN_URL`          | no               | `https://oauth2.googleapis.com/token`                                | Overridden in tests.                                                                    |
| `GOOGLE_REDIRECT_ALLOWLIST` | no               | `http://localhost:8081`                                              | Comma-separated exact redirect URIs accepted by `POST /auth/google/code`.               |
| `PUSH_URL`                  | no               | `https://exp.host/--/api/v2/push/send`                               | Expo push API; point at a local collector when testing.                                 |
| `EXPO_ACCESS_TOKEN`         | no               | unset                                                                | Server-only Expo push access token (enhanced push security).                            |
| `PUBLIC_API_URL`            | no               | `http://localhost:3100`                                              | Canonical API origin for share links. Production `https://shrkltr-api.wtchthfck.com`.   |
| `PUBLIC_WEB_URL`            | no               | `http://localhost:8081`                                              | Web app origin for claim/invite/join links. Production `https://shrkltr.wtchthfck.com`. |
| `CORS_ORIGINS`              | no               | `http://localhost:8081`                                              | Comma-separated exact browser origins allowed by CORS; no paths or wildcards.           |
| `CLAIM_TTL_DAYS`            | no               | `30`                                                                 | Days before a placeholder claim link expires (1–365).                                   |
| `GROUP_INVITE_TTL_DAYS`     | no               | `30`                                                                 | Default days before a group invite expires (1–365).                                     |
| `MAINTENANCE_ENABLED`       | no               | `true`                                                               | Runs the 60-second challenge expiry/reminder sweep; `false` in tests.                   |
| `LOG_LEVEL`                 | no               | `info`                                                               |                                                                                         |

### `apps/mobile/.env` (gitignored; template in `apps/mobile/.env.example`)

| Variable                       | Default / example          | Notes                                                                     |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`          | `http://localhost:3100`    | Use the Mac's LAN address on a physical device (see the mobile README).   |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | same as `GOOGLE_CLIENT_ID` | Public client ID used for the PKCE authorization request.                 |
| `EXPO_PUBLIC_ENV`              | `development`              | `production` hides the dev sign-in control.                               |
| `EXPO_PUBLIC_DEV_AUTH`         | empty                      | Set to the root `DEV_AUTH_SECRET` to enable dev sign-in. Dev builds only. |

Every `EXPO_PUBLIC_*` value is inlined into the app bundle. Never put a real secret there.
Restart the Expo dev server after editing `apps/mobile/.env`.

### Setting up `GOOGLE_CLIENT_SECRET`

Real Google login sends the authorization code to the backend (`POST /auth/google/code`), which
exchanges it with Google using the Web-application client secret. Only the backend ever holds
that secret.

1. In Google Cloud Console, open **APIs & Services → Credentials** and the Web-application OAuth
   client whose ID is `GOOGLE_CLIENT_ID`. Check that `http://localhost:8081` is listed under both
   **Authorized JavaScript origins** and **Authorized redirect URIs**.
2. Copy its client secret and paste it into the **root** `.env` (gitignored):
   `GOOGLE_CLIENT_SECRET=<your secret>`.
3. Recreate the api container so it reloads `.env`: `docker compose up -d --force-recreate api`.
   A `tsx watch` restart does not reload environment variables.

Never commit the secret, never put it in `apps/mobile/.env` or any `EXPO_PUBLIC_*` variable, and
never paste it into chat or logs. While it is unset, `POST /auth/google/code` answers 503 and the
app shows a sign-in error; dev sign-in keeps working.

## Troubleshooting

- **`/health` fails right after `docker compose up -d`**: the api is still applying migrations.
  Use the wait line from the quick start (up to 60 seconds). If it gives up, check
  `docker compose logs api`.
- **Seed fails with "relation ... does not exist"**: it ran before the api finished migrating.
  Run the wait line, then seed again.
- **A backend change is not picked up** (for example a new route returns 404): `tsx watch`
  sometimes misses bind-mount changes on macOS. Run `docker compose restart api`.
- **`.env` change ignored by the api**: recreate it with `docker compose up -d --force-recreate api`.
- **Port 5433, 3100, or 8081 already in use**: find the owner with `lsof -i :<port>` and stop it.
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
