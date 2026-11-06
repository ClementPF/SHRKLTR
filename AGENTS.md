# Sharkulator agent guide

Use npm workspaces from the repo root (Node 24+). Do not use pnpm, yarn, or bun. The mobile app
has its own rules in `apps/mobile/AGENTS.md`.

## Validation

Pick the smallest level that covers the change, and run the levels below it too:

| Change                                     | Run                                                    |
| ------------------------------------------ | ------------------------------------------------------ |
| Any change                                 | `npm run lint` and `npm run typecheck`                 |
| Backend or mobile logic                    | Tests of the touched workspace (see `README.md`)       |
| Anything a user can see or reach in the UI | `npm run e2e:smoke`, plus the spec covering the change |
| Broad changes, auth, groups, game entry    | `npm run e2e` (full browser suite)                     |
| Before handing off a finished task         | `npm run validate` (lint, typecheck, all tests, smoke) |

Backend tests need the database: `docker compose up -d db`. `npm run validate` and the browser
tests need it too.

Add or update a Playwright spec in `e2e/` when you change a user journey. Tag fast,
critical-path tests with `@smoke`. Use agent-driven browsing (agent-browser) only for new UX,
visual review, or investigating a failing spec, not as the routine final check.

## Browser tests (Playwright)

The suite runs against its own stack, separate from the dev stack:

- API on `127.0.0.1:3191`, Expo web on `127.0.0.1:8091`, readiness at `127.0.0.1:3192/ready`
- Database `sharkulator_e2e` in the compose `db` container, created and migrated automatically
- Fixed local-only secrets; `.env` and `apps/mobile/.env` are never read
- Every test resets that database to the dev seed, so tests are independent and run one at a time

It never touches `sharkulator_dev`, ports 3100/8081, or your Expo dev server.

### Reuse the servers during a task

Start the stack once in the background and keep it running while you work:

```sh
npm run e2e:serve        # long-running; ready when it prints "E2E ready"
```

Playwright reuses a running stack, so each test run skips startup. API code reloads through
`--watch` and Metro watches app code, so edits apply without a restart. Restart only after
changing dependencies or `apps/backend/e2e/environment.ts`.

If nothing is running, `npm run e2e` and `npm run e2e:smoke` start the stack themselves and stop
it afterwards. Stop a background stack with `npm run e2e:stop`; it only signals a process that
identifies itself as this harness. If startup reports an occupied port, find the owner with
`lsof -i :<port>`; do not stop a process you did not start.

### Commands

```sh
npm run e2e:smoke                          # @smoke tests
npm run e2e                                # full suite
npx playwright test e2e/groups.spec.ts     # one file
npx playwright test -g "removal evicts"    # one test by name
```

### Writing specs

- Import `test` and `expect` from `e2e/fixtures.ts`. `signIn(username)` returns a signed-in page
  in its own browser context, so two users can act side by side. Only `smoke.spec.ts` signs in
  through the UI.
- Prepare data through the API (`API_URL` in `apps/backend/e2e/environment.ts`) rather than
  clicking through setup screens. Seeded users and fixtures come from
  `apps/backend/src/db/seed.ts`.
- Use role, label, and `testID` locators and web-first assertions. Never add fixed sleeps.
- Do not reload to make data appear: a reload empties the query cache, which hides cache bugs.
  Navigate the way a user would instead.
- Game entry uses the dev QR payload (`qr-payload` and the scanner's paste field) because headless
  browsers have no camera. Real camera scans, native gestures, and Google consent stay in
  `DEVICE-CHECKLIST.md`.

### Failures

Failed tests keep a screenshot of every signed-in user, a trace, and an error context under
`test-results/`. Open a trace with `npx playwright show-trace <path>/trace.zip`. The HTML report
is in `playwright-report/`.
