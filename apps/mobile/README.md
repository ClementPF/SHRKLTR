# Sharkulator mobile

Expo SDK 58 app (expo-router, TypeScript strict) for iOS, Android, and web.

## Setup

From the repo root:

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env   # init.sh does this automatically
docker compose up -d                            # db + api on :3100
```

`apps/mobile/.env` holds the public `EXPO_PUBLIC_*` values (API URL, Google web client ID).
They are inlined into the bundle, so never put secrets there. On a physical device, set
`EXPO_PUBLIC_API_URL` to the Mac's LAN address (for example `http://192.168.x.x:3100`).

Dev sessions: in non-production builds (`EXPO_PUBLIC_ENV` other than `production`), set
`EXPO_PUBLIC_DEV_AUTH` to the `DEV_AUTH_SECRET` from the repo-root `.env`. The app sends it as
the `x-dev-auth` header to `POST /auth/dev-token` to sign in as a seeded user without Google.
Leave it empty in production builds.

## Sign-in

Unauthenticated users land on `/login`; the `(app)` routes are guarded by `Stack.Protected` in
`src/app/_layout.tsx`. On launch a stored session is checked against `GET /users/me`, which
refreshes an expired access token or returns to the login screen when the refresh token is revoked.

- **Continue with Google** runs the authorization-code flow with PKCE (S256) through
  `expo-auth-session`. After Google redirects back with the code, the app posts
  `{code, codeVerifier, redirectUri}` to the backend `POST /auth/google/code`; the backend
  exchanges the code server-side with the server-only client secret (the app never calls
  Google's token endpoint and holds no secret). On web the redirect URI is
  `http://localhost:8081`, which must be registered for `EXPO_PUBLIC_GOOGLE_CLIENT_ID`.
- **Dev sign-in** (non-production builds with `EXPO_PUBLIC_DEV_AUTH` set) lists the seeded users
  and signs in through `/auth/dev-token`. Use it for browser E2E and Expo Go on a device.
- **Settings → LOGOUT** revokes the session server-side and clears stored tokens and cached data.
  The version label ends in `L` for a local/LAN API URL and `R` for a remote one.

## Run

```bash
cd apps/mobile
CI=true npx expo start --port 8081   # web at http://localhost:8081, Expo Go via the QR code
```

The first web compile takes 1-3 minutes.

## Test and typecheck

```bash
CI=true npm run test -w apps/mobile
npm run typecheck -w apps/mobile
```

Tests live in `__tests__/` and use jest-expo with React Native Testing Library 14
(`render()` is async, so always `await render(...)`).

## Layout

- `src/app/` routes: `(app)/(tabs)/` holds the feed, me, add-game, tournaments, and settings tabs.
- `src/api/` typed client (`client.ts`: Bearer auth, single-flight refresh on 401, one retry,
  session + query cache cleared only when a refresh is definitively rejected (4xx; transient
  network/5xx failures keep the session for a later retry)), DTO types and per-route `endpoints.ts`.
- `src/auth/` session layer: `storage.ts` (SecureStore on native, `localStorage` on web, one
  JSON key `sharkulator.session`), `session-store.ts` (the only owner of session side effects:
  token persistence, sign-out/expiry cleanup of the query cache and auth-lost, all checked
  against the session generation inside serialized transitions), `session.tsx` (`SessionProvider`/`useSession`, shows a loading
  view until stored tokens hydrate), `devSession.ts`.
- `src/notifications/` push registration (native only; web is a no-op).
- Feed / Me / `user/[username]` (tournament user detail): `src/features/feed/` screens and
  `src/features/users/queries.ts` hooks (`useUserGames` is an infinite query, 15 per page on the
  feed and 10 on profiles; query keys are rooted at `users` and `stats` for invalidation).
  The seeded `dev-alex` has more than 15 games (incl. the `Lunch Darts` tournament), so feed
  infinite scroll can be exercised against seed data. Failures surface through the in-app
  `DropdownAlert` banner (`showAlert`), because `Alert.alert` is a no-op on web.
- Tournaments tab: `src/features/tournaments/` (searchable list filtered client-side by display
  name, `@name` or sport; `/new-tournament` create form; `/tournament/[name]` detail with a
  RANKING computed from `GET /tournaments/:name/stats` and a HISTORY infinite query of 10 per
  page). Query keys are rooted at `tournaments`.
- Refresh: tab and detail routes call `useInvalidateOnFocus` (`src/lib/`) so returning to a screen
  refetches data changed elsewhere (e.g. a game submitted from another device); received or
  opened push notifications invalidate every query (`src/notifications/`, wired in the root layout).
- Add Game tab (QR-only game entry): `src/features/game-form/`. The tab asks WON or LOST.
  Winners open `/game-form/winner`, a QR code (react-native-qrcode-svg, 220px) of
  `{username, tournamentName, tournament: {name}, result: "WIN"}`. Losers open
  `/game-form/scanner`: an expo-camera `CameraView` scanning QR codes, with camera-unavailable
  and permission-denied states (headless browsers show one of these) and a Get Scanned toggle that
  shows the loser's own `LOSS` code for team mates. Each scan is parsed and validated by the pure
  helpers in `src/lib/qr.ts` (required keys, same tournament, username dedupe, outcomes seeded with
  the scanner's own LOSS); the zustand draft (`store.ts`) holds the tournament and scanned outcomes.
  Both screens default to the tournament of the player's latest game and re-pick it through EDIT
  (`/game-form/tournament`: recent + all tournaments, searchable). "All good" stays disabled until
  the teams are complete, then asks for confirmation, POSTs `/tournaments/:name/games`, opens
  `/game-form/result?id=` and invalidates the `users`, `stats` and `tournaments` queries so mounted
  feed/history lists refetch immediately. Non-production builds print the QR payload under each
  code and offer a "paste a QR code payload" field on the scanner, so the flow can be driven
  without a camera (copy the winner's payload into the loser's field).
- `src/features/` TanStack Query hooks,
  `src/components/` shared UI, `src/theme/` dark theme constants (accent `#CE2924`).
