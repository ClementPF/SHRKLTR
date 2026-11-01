import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const gameResult = pgEnum('game_result', ['WIN', 'TIE', 'LOSS']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email'),
  emailVerified: boolean('email_verified').notNull().default(false),
  firstName: text('first_name'),
  lastName: text('last_name'),
  username: text('username').notNull().unique(),
  pictureUrl: text('picture_url'),
  locale: text('locale'),
  pushToken: text('push_token'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
