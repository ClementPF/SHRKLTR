import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const gameResult = pgEnum('game_result', ['WIN', 'TIE', 'LOSS']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const accountType = pgEnum('account_type', ['REGISTERED', 'PLACEHOLDER']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULL only for placeholders; a claim binds a Google subject to the same row.
    googleSub: text('google_sub').unique(),
    accountType: accountType('account_type').notNull().default('REGISTERED'),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    firstName: text('first_name'),
    lastName: text('last_name'),
    username: text('username').notNull().unique(),
    pictureUrl: text('picture_url'),
    locale: text('locale'),
    pushToken: text('push_token'),
    createdByUserId: uuid('created_by_user_id').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('users_created_by_account_type_idx').on(t.createdByUserId, t.accountType),
    check(
      'users_account_identity_check',
      sql`(${t.accountType} = 'PLACEHOLDER' and ${t.googleSub} is null and ${t.email} is null and ${t.claimedAt} is null and ${t.emailVerified} = false) or (${t.accountType} = 'REGISTERED' and ${t.googleSub} is not null)`,
    ),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    jti: text('jti').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('refresh_tokens_family_idx').on(t.familyId),
    unique('refresh_tokens_jti_unique').on(t.jti),
  ],
);

export const sports = pgTable('sports', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export const tournaments = pgTable(
  'tournaments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    displayName: text('display_name').notNull(),
    isOver: boolean('is_over').notNull().default(false),
    sportId: uuid('sport_id')
      .notNull()
      .references(() => sports.id),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('tournaments_sport_idx').on(t.sportId)],
);

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    date: timestamp('date', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('games_tournament_date_idx').on(t.tournamentId, t.date.desc())],
);

export const outcomes = pgTable(
  'outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    result: gameResult('result').notNull(),
    scoreValue: doublePrecision('score_value').notNull(),
    // Tournament rating just before the game; NULL for outcomes recorded before snapshots existed.
    ratingBefore: doublePrecision('rating_before'),
  },
  (t) => [index('outcomes_game_idx').on(t.gameId), index('outcomes_user_idx').on(t.userId)],
);

// Shared by stats and rivalry_stats. The DB keeps the legacy "longuest" spelling; the API is camelCase.
const statColumns = () => ({
  score: doublePrecision('score').notNull(),
  bestScore: doublePrecision('best_score').notNull(),
  worstScore: doublePrecision('worst_score').notNull(),
  gameCount: integer('game_count').notNull().default(0),
  winCount: integer('win_count').notNull().default(0),
  loseCount: integer('lose_count').notNull().default(0),
  tieCount: integer('tie_count').notNull().default(0),
  winStreak: integer('win_streak').notNull().default(0),
  loseStreak: integer('lose_streak').notNull().default(0),
  tieStreak: integer('tie_streak').notNull().default(0),
  longuestWinStreak: integer('longuest_win_streak').notNull().default(0),
  longuestLoseStreak: integer('longuest_lose_streak').notNull().default(0),
  longuestTieStreak: integer('longuest_tie_streak').notNull().default(0),
});

export const stats = pgTable(
  'stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    ...statColumns(),
    // No FK: rivalry rows are replaced by application logic.
    bestRivalryId: uuid('best_rivalry_id'),
    worstRivalryId: uuid('worst_rivalry_id'),
  },
  (t) => [
    unique('stats_user_tournament_unique').on(t.userId, t.tournamentId),
    index('stats_tournament_idx').on(t.tournamentId),
  ],
);

export const rivalryStats = pgTable(
  'rivalry_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rivalId: uuid('rival_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    ...statColumns(),
  },
  (t) => [
    unique('rivalry_stats_user_rival_tournament_unique').on(t.userId, t.rivalId, t.tournamentId),
    index('rivalry_stats_tournament_idx').on(t.tournamentId),
  ],
);

/** One current one-time claim link per placeholder; only the SHA-256 of the token is stored. */
export const playerClaims = pgTable(
  'player_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    placeholderUserId: uuid('placeholder_user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    creatorUserId: uuid('creator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('player_claims_creator_created_idx').on(t.creatorUserId, t.createdAt.desc()),
    check(
      'player_claims_not_consumed_and_revoked_check',
      sql`${t.consumedAt} is null or ${t.revokedAt} is null`,
    ),
  ],
);

/** One reusable general invitation link per registered user; reissue replaces the hash. */
export const appInvites = pgTable('app_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorUserId: uuid('creator_user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
});
