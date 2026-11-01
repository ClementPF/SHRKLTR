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

## Production image

```sh
docker build --target prod -t sharkulator-api .
```
