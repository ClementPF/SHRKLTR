# Self-hosting

Runs the production stack on one always-on machine (for example an old MacBook) and publishes it
through a Cloudflare Tunnel. `docker-compose.prod.yml` starts four containers:

| Service       | What it runs                                              | Reached at               |
| ------------- | --------------------------------------------------------- | ------------------------ |
| `db`          | Postgres 17, data in the `sharkulator_prod_pgdata` volume | compose network only     |
| `api`         | `Dockerfile` `prod` target, `APP_ENV=production`          | `https://<API_HOSTNAME>` |
| `web`         | Static Expo web export served by nginx (`docker/web/`)    | `https://<APP_HOSTNAME>` |
| `cloudflared` | Cloudflare Tunnel connector, authenticated by a token     | outbound connection only |

No port is published on the host: Cloudflare forwards traffic through the tunnel to `api` and
`web` over the compose network. The api applies database migrations on boot, and
`/auth/dev-token` does not exist in production, so users sign in with Google.

## 1. Cloudflare Tunnel

1. In the Cloudflare dashboard, open **Zero Trust → Networks → Tunnels** and create a tunnel of
   type **Cloudflared** (for example `sharkulator`). Use a dedicated tunnel: your other tunnels'
   connectors cannot resolve the `api` and `web` container names.
2. On the connector install step, copy the token (the long value after `--token`). It goes into
   `CLOUDFLARE_TUNNEL_TOKEN`; there is nothing to install on the host.
3. Add two public hostnames to the tunnel:

   | Public hostname     | Service type | URL        |
   | ------------------- | ------------ | ---------- |
   | `app.<your-domain>` | HTTP         | `web:80`   |
   | `api.<your-domain>` | HTTP         | `api:3100` |

Cloudflare terminates HTTPS, so both hostnames are served over `https://`.

## 2. Google OAuth client

In Google Cloud Console (**APIs & Services → Credentials**), open the Web-application client
whose ID is `GOOGLE_CLIENT_ID` and add `https://app.<your-domain>` to both **Authorized
JavaScript origins** and **Authorized redirect URIs**. Keep `http://localhost:8081` for local
development. Copy the client secret for the next step (create a new one with **Add secret** if
the existing one is no longer shown).

## 3. Configure

From the repo root on the server:

```sh
cp .env.production.example .env.production
for k in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET DEV_AUTH_SECRET; do sed -i '' "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env.production; done
```

Then edit `.env.production` and set `APP_HOSTNAME`, `API_HOSTNAME`, `CLOUDFLARE_TUNNEL_TOKEN` and
`GOOGLE_CLIENT_SECRET`. The file is gitignored; never commit it. Use the production secrets only
here, not the ones from your development `.env`.

The compose file derives the rest from these values: the api allows CORS and Google redirects
from `https://<APP_HOSTNAME>` only, and the web app is built against `https://<API_HOSTNAME>`
with dev sign-in removed.

## 4. Start

```sh
npm run prod -- up -d --build
npm run prod -- ps          # api, db and web should become healthy
curl https://api.<your-domain>/health
```

`npm run prod --` wraps `docker compose -f docker-compose.prod.yml --env-file .env.production`, so
any compose command works: `npm run prod -- logs -f api`, `npm run prod -- down`.

Open `https://app.<your-domain>` and sign in with Google. On a phone, open the same URL in
Safari and use **Share → Add to Home Screen**. Expo Go cannot sign in against this server:
Google rejects its `exp://` redirect and dev sign-in is disabled in production.

## Updating

```sh
git pull
npm run prod -- up -d --build
```

The web image inlines `APP_HOSTNAME`/`API_HOSTNAME`/`GOOGLE_CLIENT_ID` at build time, so rebuild
(`--build`) after changing them.

## Keeping a MacBook server up

- Docker Desktop: **Settings → General → Start Docker Desktop when you sign in**. Docker Desktop
  only runs in a logged-in session, so enable automatic login for the server user
  (**System Settings → Users & Groups**). Every container uses `restart: unless-stopped`.
- Never sleep, also with the lid closed (keep it on power): `sudo pmset -a sleep 0 disablesleep 1`.
- Power back on after an outage: `sudo pmset -a autorestart 1`.

## Backups

All data lives in the `sharkulator_prod_pgdata` volume on this one machine. Dump it daily to
another disk or a synced folder:

```sh
mkdir -p ~/sharkulator-backups
npm run prod -- exec -T db pg_dump -U sharkulator -Fc sharkulator > ~/sharkulator-backups/$(date +%F).dump
```

Restore into a running stack with:

```sh
npm run prod -- exec -T db pg_restore -U sharkulator -d sharkulator --clean --if-exists < ~/sharkulator-backups/<date>.dump
```

`npm run prod -- down -v` deletes the volume and every row in it; use plain `down` to stop.
