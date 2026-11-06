# Sharkulator mobile

Expo SDK 58 app (expo-router, TypeScript strict) for iOS, Android, and web.

## Setup

From the repo root:

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env   # init.sh does this automatically
docker compose up -d                            # db + api on :3100
```

`apps/mobile/.env` holds the public `EXPO_PUBLIC_*` values: `EXPO_PUBLIC_API_URL` (API origin),
`EXPO_PUBLIC_WEB_URL` (web app origin, default `http://localhost:8083`; production
`https://shrkltr.wtchthfck.com`), `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, `EXPO_PUBLIC_ENV` and
`EXPO_PUBLIC_DEV_AUTH`.
They are inlined into the bundle, so never put secrets there (in particular, the Google client
secret lives only in the root `.env`). On a physical device, set `EXPO_PUBLIC_API_URL` to the
Mac's LAN address; see [Expo Go on a physical device](#expo-go-on-a-physical-device).

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
  Google's token endpoint and holds no secret). On web the redirect URI is exactly
  `EXPO_PUBLIC_WEB_URL` (`http://localhost:8083` locally), which must be an authorized redirect URI
  of the Google web client `EXPO_PUBLIC_GOOGLE_CLIENT_ID` and be listed in the backend
  `GOOGLE_REDIRECT_ALLOWLIST`.
- **Dev sign-in** (non-production builds with `EXPO_PUBLIC_DEV_AUTH` set) lists the seeded users
  and signs in through `/auth/dev-token`. Use it for browser E2E and Expo Go on a device.
- **Settings → LOGOUT** revokes the session server-side and clears stored tokens and cached data.
  The version label ends in `L` for a local/LAN API URL and `R` for a remote one.

## Run

```bash
cd apps/mobile
CI=true npx expo start --port 8083   # web at http://localhost:8083, Expo Go via the QR code
```

The first web compile takes 1-3 minutes. Drop `CI=true` to get the interactive terminal with
the Expo Go QR code. Restart with `--clear` after changing `apps/mobile/.env`.

## Expo Go on a physical device

Expo Go loads the JavaScript bundle from the Mac's dev server. The iPhone and the Mac must be on
the same Wi-Fi network, and Expo Go must support SDK 58 (keep it updated from the App Store).

1. Find the Mac's LAN address: `ipconfig getifaddr en0` (for example `192.168.1.21`).
2. In `apps/mobile/.env`, point the app at the API through that address. `localhost` on the phone
   is the phone itself, so the default does not work on a device:

   ```sh
   EXPO_PUBLIC_API_URL=http://192.168.1.21:3100
   ```

   The Mac browser keeps working with this value (Docker publishes port 3100 on every
   interface). Set it back to `http://localhost:3100` when you are done.

3. Start the dev server in interactive mode so it prints a QR code, clearing the cache so the new
   env value is inlined:

   ```sh
   cd apps/mobile
   npx expo start --port 8083 --clear
   ```

4. On the iPhone, scan the terminal QR code with the Camera app (it opens Expo Go), or open Expo
   Go and enter `exp://192.168.1.21:8083` manually. If macOS asks whether Node may accept incoming
   connections, allow it.
5. On the login screen, use **DEV SIGN-IN**: pick a seeded user chip (for example `dev-sam`) or
   type a username, then sign in. This calls `POST /auth/dev-token` with `EXPO_PUBLIC_DEV_AUTH`.
   **Continue with Google** is for the web app; Expo Go cannot complete it because the Google
   web client only allows the web-origin redirect (`http://localhost:8083` locally).
6. The version label at the bottom of the login and settings screens ends in `L` when the app
   talks to a local/LAN API.

If the phone shows network errors, check that the label shows the LAN URL, that
`curl http://<LAN-IP>:3100/health` works from the Mac, and that both devices are on the same
network (guest networks often isolate clients).

The camera permission prompt appears the first time the scanner opens. If you denied it, enable
the camera for Expo Go in iOS Settings.

## Push notifications on a real phone

The inbox, the bell and **Settings → Notifications** work everywhere, including web and Expo Go.
Remote push to a phone does not work in Expo Go: since SDK 53, `expo-notifications` push is
unavailable in Expo Go on Android, and the app registers a device only when it has an EAS project
ID. You need a development build (or a release build) with your own Expo project and push
credentials. Per the SDK 58 `expo-notifications` and push setup docs:

1. **EAS project ID.** Create or link an Expo project with `npx eas-cli@latest init` from
   `apps/mobile`. It writes `expo.extra.eas.projectId` (a UUID) into `app.json`. The app reads
   `Constants.expoConfig.extra.eas.projectId`, then `Constants.easConfig.projectId`, and passes it
   to `getExpoPushTokenAsync({ projectId })`. Without it the app logs "Push disabled: no EAS
   projectId in the app config." once and works without push. The `expo-notifications` config
   plugin is already listed in `app.json`.
2. **Development build.** Install the dev client with `npx expo install expo-dev-client`, then
   build with `npx eas-cli@latest build --profile development --platform ios` (or `android`), or
   locally with `npx expo run:ios --device` / `npx expo run:android`. Use a physical device: push
   tokens are for real devices. Never create or edit `ios/` or `android/` by hand.
3. **Credentials.** iOS needs a paid Apple Developer account; answer yes when EAS CLI asks to set
   up push notifications (or run `npx eas-cli@latest credentials`), which creates the APNs key.
   Android needs Firebase Cloud Messaging V1: upload the Google service account key with
   `npx eas-cli@latest credentials` (Expo docs: "Add Android FCM V1 credentials"), download the
   Firebase `google-services.json` into `apps/mobile` and reference it as
   `expo.android.googleServicesFile` in `app.json`.
4. **Server.** No server change is needed: the API sends through the Expo push service
   (`PUSH_URL` default). Set `EXPO_ACCESS_TOKEN` in the root `.env` only if you enable enhanced
   push security for the project. On a phone, `EXPO_PUBLIC_API_URL` must be reachable from the
   device (LAN address locally, the production API otherwise).

After signing in, the build asks for notification permission and registers the device
(`POST /users/me/push-devices`). Logout unregisters only that installation. Tapping a push opens
its screen (game, challenge, group, achievements or profile), both while the app runs and from a
cold start. The full manual check is section 4 of
[DEVICE-CHECKLIST.md](../../DEVICE-CHECKLIST.md#4-push-on-a-real-phone).

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
  and permission-denied states (headless browsers show one of these; the availability probe runs on
  web only, native goes straight to the permission request) and a Get Scanned toggle that
  shows the loser's own `LOSS` code for team mates. Each scan is parsed and validated by the pure
  helpers in `src/lib/qr.ts` (required keys, same tournament, username dedupe, outcomes seeded with
  the scanner's own LOSS); the zustand draft (`store.ts`) holds the tournament and scanned outcomes.
  Both screens default to the tournament of the player's latest game and re-pick it through EDIT
  (`/game-form/tournament`: recent + all tournaments, searchable). The scanner header respects the
  device safe area. A scan that completes the teams automatically opens a popup showing the
  tournament, winners and losers, and pauses the camera. Cancel keeps the draft for more players;
  "Review game" reopens the popup (disabled until teams are complete). "Confirm game"
  POSTs `/tournaments/:name/games`, opens
  `/game-form/result?id=` (the game detail screen plus next-step buttons, pre-filled from the
  submission response) and invalidates the `users`, `stats` and `tournaments` queries so mounted
  feed/history lists refetch immediately. Non-production builds print the QR payload under each
  code and offer a "paste a QR code payload" field on the scanner, so the flow can be driven
  without a camera (copy the winner's payload into the loser's field).
- Game detail: `/games/[id]` (`src/features/games/`) reads `GET /games/:id` under the
  `['games', 'detail', id]` key, so it survives reloads and deep links (the `(app)` stack anchors
  on `(tabs)` to keep a back button). Feed, profile and tournament history rows open it; the
  live rivalry that rows used to expand now shows on this screen.
- `src/features/` TanStack Query hooks,
  `src/components/` shared UI, `src/theme/` dark theme constants (accent `#CE2924`).
