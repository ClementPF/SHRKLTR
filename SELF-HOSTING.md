# Self-hosting

Runs the production stack on one always-on machine (for example an old MacBook) and publishes it
through a Cloudflare Tunnel. `docker-compose.prod.yml` starts four containers:

| Service       | What it runs                                              | Reached at               |
| ------------- | --------------------------------------------------------- | ------------------------ |
| `db`          | Postgres 17, data in the `sharkulator_prod_pgdata` volume | compose network only     |
| `api`         | `Dockerfile` `prod` target, `APP_ENV=production`          | `https://<API_HOSTNAME>` |
| `web`         | Static Expo web export served by nginx (`docker/web/`)    | `https://<APP_HOSTNAME>` |
| `cloudflared` | Optional Cloudflare Tunnel connector (`tunnel` profile)   | outbound connection only |

With the bundled tunnel no port is published on the host: Cloudflare forwards traffic to `api`
and `web` over the compose network. If a reverse proxy and tunnel already run on another
machine, publish `api` and `web` on the local network instead (option B below). The api applies database migrations on boot, and
`/auth/dev-token` does not exist in production, so users sign in with Google.

## 1. Cloudflare Tunnel

Pick the option that matches your network.

### Option A: tunnel in this stack (one machine)

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

### Option B: existing tunnel and reverse proxy on another machine

`docker-compose.lan.yml` publishes the api on port `3100` and the web app on port `8080` of the
server, and the `cloudflared` service stays off. Leave `CLOUDFLARE_TUNNEL_TOKEN` empty. If either
port is taken, set `API_PORT` / `WEB_PORT` in `.env.production` and use those in the proxy.

1. On the proxy machine, route both hostnames to the server (`<server-ip>` below). With nginx:

   ```nginx
   server {
     listen 80;
     server_name app.<your-domain>;
     location / {
       proxy_pass http://<server-ip>:8080;
       proxy_set_header Host $host;
     }
   }
   server {
     listen 80;
     server_name api.<your-domain>;
     location / {
       proxy_pass http://<server-ip>:3100;
       proxy_set_header Host $host;
     }
   }
   ```

2. In your existing tunnel, add `app.<your-domain>` and `api.<your-domain>` as public hostnames
   pointing at the proxy (the same service URL your other hostnames use, for example
   `http://localhost:80`).
3. Reserve both machines' IP addresses in your router so the proxy keeps reaching the server.

Ports 3100 and 8080 are open to the whole local network; restrict them to the proxy's address in
the server's firewall if that matters.

Either way, Cloudflare terminates HTTPS, so both hostnames are served over `https://`. Cloudflare's
free certificate only covers one subdomain level (`*.<your-domain>`): use names like
`app.<your-domain>`, not `app.sub.<your-domain>`, which fail the TLS handshake.

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

Then edit `.env.production` and set `APP_HOSTNAME`, `API_HOSTNAME`, `GOOGLE_CLIENT_SECRET` and,
for option A, `CLOUDFLARE_TUNNEL_TOKEN`. The file is gitignored; never commit it. Use the production secrets only
here, not the ones from your development `.env`.

The compose file derives the rest from these values: the api allows CORS and Google redirects
from `https://<APP_HOSTNAME>` only, and the web app is built against `https://<API_HOSTNAME>`
with dev sign-in removed.

## 4. Start

Option A (tunnel in this stack):

```sh
npm run prod -- --profile tunnel up -d --build
```

Option B (reverse proxy on another machine):

```sh
npm run prod:lan -- up -d --build
curl http://localhost:3100/health   # also from the proxy machine: http://<server-ip>:3100/health
```

Then check:

```sh
npm run prod -- ps          # api, db and web should become healthy
curl https://api.<your-domain>/health
```

`npm run prod --` wraps `docker compose -f docker-compose.prod.yml --env-file .env.production`
(`prod:lan` adds `-f docker-compose.lan.yml`), so any compose command works:
`npm run prod -- logs -f api`, `npm run prod -- down`.
Open `https://app.<your-domain>` and sign in with Google. On a phone, open the same URL in
Safari and use **Share → Add to Home Screen**. Expo Go cannot sign in against this server:
Google rejects its `exp://` redirect and dev sign-in is disabled in production.

## Updating

```sh
git pull
npm run prod -- --profile tunnel up -d --build   # option B: npm run prod:lan -- up -d --build
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
