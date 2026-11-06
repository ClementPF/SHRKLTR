# Sharkulator backend

Fastify 5 + Zod 4 (`@fastify/type-provider-zod`) + Drizzle ORM (1.0 rc, postgres-js) on
PostgreSQL 17. Configuration, ports, and the full env var table are in the
[root README](../../README.md).

## Run

The normal way is Docker Compose from the repo root:

```sh
docker compose up -d          # db on :5433, api on :3100 with tsx watch + bind mount
i=0; until curl -sf localhost:3100/health; do i=$((i+1)); if [ "$i" -ge 60 ]; then echo "API not healthy after 60 s; run: docker compose logs api" >&2; break; fi; sleep 1; done; echo
[ "$i" -lt 60 ] && npm run seed -w apps/backend   # idempotent demo data, only once the api is up
```

The wait line polls `/health` once a second for up to 60 seconds and prints
`{"status":"ok","database":"up"}` when the api is ready. The api applies migrations before it
answers, so seeding earlier can fail with "relation does not exist". If the wait gives up it prints
`API not healthy after 60 s` and the seed line does nothing; check `docker compose logs api`, fix
the cause, and run both lines again.

The api container bind-mounts `apps/backend` and restarts on file changes. If a change is not
picked up, run `docker compose restart api`. After editing the root `.env`, run
`docker compose up -d --force-recreate api`.

Scripts (run with `npm run <script> -w apps/backend` from the root):

| Script                       | What it does                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `dev`                        | `tsx watch src/server.ts` on the host (needs a host `DATABASE_URL` on `localhost:5433`) |
| `build` / `start`            | compile to `dist/` and run it                                                           |
| `test`                       | vitest, sequential files, against `sharkulator_test`                                    |
| `typecheck`                  | `tsc --noEmit`                                                                          |
| `seed`                       | idempotent demo data; prints LOCAL ONLY fixture links                                   |
| `achievements:backfill`      | award historical badges once (`-- --dry-run` to only report, `-- --batch-size=N`)       |
| `db:generate` / `db:migrate` | drizzle-kit                                                                             |

## API

- Swagger UI at http://localhost:3100/docs, OpenAPI JSON at `/docs/json`, generated from the zod
  route schemas.
- JSON is camelCase. Errors always use `{"error": {"code": "...", "message": "..."}}`
  (`VALIDATION_ERROR` for zod failures, `BAD_REQUEST` for unparseable JSON, `NOT_FOUND` for unknown
  routes, `INTERNAL_ERROR` for unexpected failures).
- Lists are paginated with `?page=0&pageSize=20` (max 100) and return a bare array.
- Configuration is parsed with zod in `src/config.ts`. Logs never include request headers;
  authorization headers, token fields, codes, verifiers, and secrets are redacted.

### Sessions

- `POST /auth/google/code {code, codeVerifier, redirectUri}` is the primary Google login. The app
  runs the PKCE authorization-code request, and the backend exchanges the code with Google using
  the server-only `GOOGLE_CLIENT_SECRET`. `redirectUri` must exactly match an entry in
  `GOOGLE_REDIRECT_ALLOWLIST` (default `http://localhost:8083`), else 400. Secret unset → 503.
  Google rejects the code → 401. Google unreachable or 5xx → 502. Returns
  `{accessToken, refreshToken, user}`.
- `POST /auth/token {provider: "google", idToken}` returns the same session for callers that
  already hold a Google ID token (verified with jose against Google's JWKS; `email_verified` is
  required).
- Access tokens (HS256, `JWT_ACCESS_SECRET`) last 15 minutes; refresh tokens (HS256,
  `JWT_REFRESH_SECRET`) last 30 days and are recorded in `refresh_tokens`.
- Protected routes use `onRequest: [app.authenticate]`, which accepts only access tokens and sets
  `request.user.id`. Refresh tokens never authorize API calls.
- `POST /auth/refresh {refreshToken}` rotates the pair. Presenting a consumed or unknown token
  returns 401 and revokes the whole token family.
- `POST /auth/logout {refreshToken}` revokes the family and returns 204.
- `POST /auth/dev-token {username}` with header `x-dev-auth: <DEV_AUTH_SECRET>` returns a session
  for an existing user (for example `dev-alex`). It answers 404 when the header is wrong and is not
  registered at all when `APP_ENV=production`.

Mint a dev session from the shell:

```sh
curl -s -X POST localhost:3100/auth/dev-token \
  -H 'content-type: application/json' \
  -H "x-dev-auth: $(grep '^DEV_AUTH_SECRET=' .env | cut -d= -f2)" \
  -d '{"username":"dev-alex"}'
```

## Database migrations and demo data

- The schema lives in `src/db/schema.ts`. After changing it, run
  `docker compose exec -T api npm run db:generate`, review the generated SQL, commit the new
  folder under `apps/backend/drizzle/`, and apply it with `docker compose restart api` (wait for
  `/health`).
- The api container applies pending migrations on every boot (`docker/api/entrypoint.sh`). The
  server also runs the drizzle migrator before listening (`src/db/migrate.ts`), so the production
  image (`docker build --target prod`) migrates its database on start.
- `npm run seed -w apps/backend` loads idempotent demo data into `sharkulator_dev` (host default
  `localhost:5433`, override with `DATABASE_URL`): users `dev-alex`, `dev-sam`, `dev-jordan`,
  `dev-taylor`, `dev-morgan`, four sports, four open tournaments (Office Babyfoot, Friday Ping
  Pong, Chess Club, Lunch Darts) with their stats and rivalries, the **Shark Tank** group
  (dev-alex OWNER, dev-sam ADMIN, dev-jordan MEMBER) with the members-only Shark Tank Cup and a
  rostered unclaimed player, placeholders in every claim-link state, challenges in every state
  (the completed one linked to its game), read and unread inbox entries, and historical badges
  from the backfill. `dev-alex` has more than 15 games, enough to exercise feed pagination. The
  full list is in the [root README](../../README.md#local-demo-data).
- Reruns insert only missing rows: they never replay games, rotate or reset fixture links, roles,
  challenges or read state, never register push devices and never push (`test/seed.test.ts`
  checks this). The seed prints the LOCAL ONLY claim links and the group invite link and code with
  their current state, on `PUBLIC_WEB_URL` taken from the shell, else the root `.env`, else
  `http://localhost:8083`, so they match the links the api issues.
- `npm run achievements:backfill -w apps/backend` awards the badges existing history qualifies for
  (first win, games played, win streaks, explorer) in bounded batches, idempotently and without
  inbox entries or push. The seed runs it for you. In production run it once after the migration
  (see [Production deployment notes](../../README.md#production-deployment-notes)).

## Tests

```sh
docker compose up -d db
npm run test -w apps/backend                       # full suite, < 2 minutes
cd apps/backend && npx vitest run test/auth.session.test.ts   # one file
```

Vitest runs against the `sharkulator_test` database on port 5433 (created by
`docker/db/init/01-create-test-db.sql`). The global setup recreates the `public` schema and
applies the committed migrations; set `TEST_DATABASE_URL` to use another database. Files run
sequentially because they share that database. Google and push are replaced by local fixtures
(`test/google-jwks.ts`, `test/google-token-endpoint.ts`, `test/push-collector.ts`) with a fake
client secret. Helpers live in `test/helpers.ts` (`buildTestApp`, `truncateAll`, factories,
`authHeadersFor`).

## Layout

- `src/app.ts`: `buildApp()` (config, CORS for the `CORS_ORIGINS` allowlist, helmet, swagger, error
  handler, JWT namespaces, routes)
- `src/routes/`: auth, users, sports, tournaments, games, stats, players (placeholders), invites,
  groups, notifications, achievements, challenges, shares (public `/s/*`), health
- `src/services/`: game submission (one transaction with challenge completion, badges and inbox),
  stats/rivalry updates, visibility, groups, claims, challenges and the 60-second maintenance
  sweep, notifications and push (after commit), share snapshots, sessions
- `src/lib/share-*.ts`: share page HTML and the satori + resvg PNG card with bundled Inter fonts
- `src/scripts/achievements-backfill.ts`: historical badge backfill CLI
- `src/elo/elo.ts`: pure Elo engine
- `src/db/`: schema, client, migrator, seed
