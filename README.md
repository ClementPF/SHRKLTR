# Sharkulator

Multi-sport tournament tracker with Elo ratings. This monorepo replaces the legacy
`SHRKLTR-BCKND` (Spring Boot) and `elo` (Expo SDK 33) projects, which stay in this folder as
read-only, gitignored references.

## Layout

- `apps/backend`: Fastify + Zod + Drizzle API (PostgreSQL 17)
- `apps/mobile`: Expo app
- `docker-compose.yml`: `db` (Postgres, host port 5433) and `api` (hot reload, port 3100)
- `Dockerfile`: `dev` target for compose, `prod` target for a slim production image

## Getting started

```sh
cp .env.example .env          # then replace the <generate-...> secrets
npm install
docker compose up -d          # starts db + api; migrations run on api boot
curl localhost:3100/health    # {"status":"ok","database":"up"}
```

The api container bind-mounts `apps/backend` and restarts on file changes. Stop with
`docker compose stop`; reset the database with `docker compose down -v`.

## Scripts

- `npm run typecheck`: TypeScript in every workspace
- `npm run lint`: ESLint + Prettier check
- `npm run test`: tests in every workspace

## Backend

- API docs: Swagger UI at http://localhost:3100/docs, OpenAPI JSON at `/docs/json` (generated
  from the zod route schemas).
- Errors always use `{"error": {"code": "...", "message": "..."}}` (`VALIDATION_ERROR` for
  zod failures, `NOT_FOUND` for unknown routes, `INTERNAL_ERROR` for unexpected failures).
- Configuration is parsed with zod in `apps/backend/src/config.ts`. Required: `DATABASE_URL`,
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DEV_AUTH_SECRET` (32+ chars each),
  `GOOGLE_CLIENT_ID`. Optional with defaults: `PORT` (3100), `HOST` (0.0.0.0), `APP_ENV`
  (development | test | production), `LOG_LEVEL` (info), `GOOGLE_JWKS_URL`, `PUSH_URL`,
  `TEST_DATABASE_URL`.
- Logs never include request headers; authorization headers and token fields are redacted.

### Backend tests

`npm run test -w apps/backend` runs vitest against the `sharkulator_test` database on port 5433
(`docker compose up -d db` first). The global setup recreates the `public` schema and pushes the
drizzle schema with `drizzle-kit push`; set `TEST_DATABASE_URL` to use another database. Test
helpers live in `apps/backend/test/helpers.ts` (`buildTestApp`, `truncateAll`, factories).

## Production image

```sh
docker build --target prod -t sharkulator-api .
```
