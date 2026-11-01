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
- `src/api/` backend config and fetchers, `src/features/` TanStack Query hooks,
  `src/components/` shared UI, `src/theme/` dark theme constants (accent `#CE2924`).
