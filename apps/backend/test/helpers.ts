import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import {
  games,
  notifications,
  outcomes,
  playerClaims,
  pushDevices,
  sports,
  stats,
  tournaments,
  users,
} from '../src/db/schema.js';
import { generateCapabilityToken, hashCapabilityToken } from '../src/lib/capability-token.js';
import type { LogDestination } from '../src/lib/logger.js';
import { TEST_DATABASE_URL } from './test-env.js';

export const testEnv: Record<string, string> = {
  APP_ENV: 'test',
  LOG_LEVEL: 'info',
  DATABASE_URL: TEST_DATABASE_URL,
  TEST_DATABASE_URL,
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef0123456789abcdef',
  DEV_AUTH_SECRET: 'test-dev-auth-secret-0123456789abcdef0123456789abcdef',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_JWKS_URL: 'http://127.0.0.1:1/jwks',
  PUSH_URL: 'http://127.0.0.1:1/push',
  MAINTENANCE_ENABLED: 'false',
};

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ ...testEnv, ...overrides });
}

export interface BuildTestAppOptions {
  env?: Record<string, string>;
  logger?: false | LogDestination;
  clock?: () => Date;
}

/** Returns an app that is not yet ready, so tests may still register extra routes. */
export async function buildTestApp(opts: BuildTestAppOptions = {}): Promise<FastifyInstance> {
  return buildApp({
    config: testConfig(opts.env),
    logger: opts.logger ?? false,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
}

export async function truncateAll(db: Database): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.map((r) => `"public"."${r.tablename}"`);
  if (names.length === 0) return;
  await db.execute(sql.raw(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`));
}

let sequence = 0;
const nextSeq = () => ++sequence;

type UserInsert = typeof users.$inferInsert;
type SportInsert = typeof sports.$inferInsert;
type TournamentInsert = typeof tournaments.$inferInsert;
type StatsInsert = typeof stats.$inferInsert;
type OutcomeResult = (typeof outcomes.$inferInsert)['result'];

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function createUser(db: Database, overrides: Partial<UserInsert> = {}) {
  const n = nextSeq();
  return firstRow(
    await db
      .insert(users)
      .values({
        googleSub: `google-sub-${n}`,
        username: `user-${n}`,
        email: `user-${n}@example.com`,
        emailVerified: true,
        firstName: `First${n}`,
        lastName: `Last${n}`,
        ...overrides,
      })
      .returning(),
  );
}

/** A PLACEHOLDER user (no Google subject, email or claim timestamp). */
export async function createPlaceholderUser(db: Database, overrides: Partial<UserInsert> = {}) {
  const n = nextSeq();
  return firstRow(
    await db
      .insert(users)
      .values({
        username: `placeholder-${n}`,
        firstName: `Guest${n}`,
        ...overrides,
        accountType: 'PLACEHOLDER',
        googleSub: null,
        email: null,
        emailVerified: false,
        claimedAt: null,
      })
      .returning(),
  );
}

export interface ClaimInput {
  placeholderUserId: string;
  creatorUserId: string;
  token?: string;
  expiresAt?: Date;
  consumedAt?: Date | null;
  revokedAt?: Date | null;
}

/** Stores a claim for the placeholder and returns it with its raw token. */
export async function createClaim(db: Database, input: ClaimInput) {
  const token = input.token ?? generateCapabilityToken();
  const claim = firstRow(
    await db
      .insert(playerClaims)
      .values({
        placeholderUserId: input.placeholderUserId,
        creatorUserId: input.creatorUserId,
        tokenHash: hashCapabilityToken(token),
        expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        consumedAt: input.consumedAt ?? null,
        revokedAt: input.revokedAt ?? null,
      })
      .returning(),
  );
  return { claim, token };
}

export async function createSport(db: Database, overrides: Partial<SportInsert> = {}) {
  return firstRow(
    await db
      .insert(sports)
      .values({ name: `sport-${nextSeq()}`, ...overrides })
      .returning(),
  );
}

export async function createTournament(db: Database, overrides: Partial<TournamentInsert> = {}) {
  const n = nextSeq();
  const sportId = overrides.sportId ?? (await createSport(db)).id;
  const ownerUserId =
    overrides.ownerUserId === undefined ? (await createUser(db)).id : overrides.ownerUserId;
  return firstRow(
    await db
      .insert(tournaments)
      .values({
        name: `tournament${n}`,
        displayName: `Tournament ${n}`,
        ...overrides,
        sportId,
        ownerUserId,
      })
      .returning(),
  );
}

export async function createStatsRow(
  db: Database,
  values: Pick<StatsInsert, 'userId' | 'tournamentId'> & Partial<StatsInsert>,
) {
  return firstRow(
    await db
      .insert(stats)
      .values({ score: 1000, bestScore: 1000, worstScore: 1000, ...values })
      .returning(),
  );
}

export interface GameRowInput {
  tournamentId: string;
  date?: Date;
  outcomes: { userId: string; result: OutcomeResult; scoreValue: number }[];
}

export async function createGameRow(db: Database, input: GameRowInput) {
  return db.transaction(async (tx) => {
    const game = firstRow(
      await tx
        .insert(games)
        .values({ tournamentId: input.tournamentId, ...(input.date ? { date: input.date } : {}) })
        .returning(),
    );
    const outcomeRows =
      input.outcomes.length === 0
        ? []
        : await tx
            .insert(outcomes)
            .values(input.outcomes.map((o) => ({ ...o, gameId: game.id })))
            .returning();
    return { game, outcomes: outcomeRows };
  });
}

/** Valid-looking Expo push token derived from a label (never a real device). */
export const expoTokenOf = (label: string) => `ExponentPushToken[${label}]`;

export async function createPushDevice(
  db: Database,
  values: Pick<typeof pushDevices.$inferInsert, 'userId'> &
    Partial<typeof pushDevices.$inferInsert>,
) {
  const n = nextSeq();
  return firstRow(
    await db
      .insert(pushDevices)
      .values({ installationId: `install-${n}`, expoToken: expoTokenOf(`device-${n}`), ...values })
      .returning(),
  );
}

export async function createNotification(
  db: Database,
  values: Pick<typeof notifications.$inferInsert, 'recipientUserId'> &
    Partial<typeof notifications.$inferInsert>,
) {
  const n = nextSeq();
  return firstRow(
    await db
      .insert(notifications)
      .values({
        type: 'placeholder_claimed',
        category: 'claims',
        dedupeKey: `fixture:${n}`,
        ...values,
      })
      .returning(),
  );
}

/** Authorization header carrying a freshly signed access token for the user. */
export async function authHeadersFor(
  app: FastifyInstance,
  userId: string,
): Promise<{ authorization: string }> {
  const token = await app.jwt.access.sign({ sub: userId, typ: 'access' });
  return { authorization: `Bearer ${token}` };
}

/** Collects pino output lines for log assertions. */
export function createLogCapture(): LogDestination & { lines: string[]; text(): string } {
  const lines: string[] = [];
  return {
    lines,
    write(msg: string) {
      lines.push(msg);
    },
    text() {
      return lines.join('');
    },
  };
}
