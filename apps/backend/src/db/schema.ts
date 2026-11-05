import { sql } from 'drizzle-orm';
import { ACHIEVEMENT_CODES } from '../achievements/catalog.js';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'groups_name_length_check',
      sql`char_length(${t.name}) between 1 and 100 and ${t.name} = btrim(${t.name})`,
    ),
  ],
);

export const groupRole = pgEnum('group_role', ['OWNER', 'ADMIN', 'MEMBER']);

/** Role authority of a group; the partial unique index guarantees at most one OWNER. */
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRole('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'group_members_pk', columns: [t.groupId, t.userId] }),
    index('group_members_user_group_idx').on(t.userId, t.groupId),
    uniqueIndex('group_members_one_owner_unique')
      .on(t.groupId)
      .where(sql`${t.role} = 'OWNER'`),
  ],
);

/** Reusable join links; only SHA-256 hashes of the URL token and the short code are stored. */
export const groupInvites = pgTable(
  'group_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    tokenHash: text('token_hash').notNull().unique(),
    codeHash: text('code_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('group_invites_group_created_idx').on(t.groupId, t.createdAt.desc())],
);

/** Placeholders recorded in a group; grants no permission, only claim auto-join. */
export const groupPlayers = pgTable(
  'group_players',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    placeholderUserId: uuid('placeholder_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'group_players_pk', columns: [t.groupId, t.placeholderUserId] }),
    index('group_players_placeholder_group_idx').on(t.placeholderUserId, t.groupId),
  ],
);

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
    // Immutable once set: grouped tournaments are readable by current group members only.
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('tournaments_sport_idx').on(t.sportId),
    index('tournaments_group_created_idx').on(t.groupId, t.createdAt),
  ],
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

export const challengeStatus = pgEnum('challenge_status', [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'COMPLETED',
  'EXPIRED',
]);

/**
 * A challenge between two registered players in one tournament. pair_low/pair_high hold the two
 * user ids sorted, so the partial unique index allows one active (PENDING/ACCEPTED) challenge per
 * pair and tournament whichever player issued it.
 */
export const challenges = pgTable(
  'challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    challengerUserId: uuid('challenger_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    opponentUserId: uuid('opponent_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pairLowUserId: uuid('pair_low_user_id').notNull(),
    pairHighUserId: uuid('pair_high_user_id').notNull(),
    status: challengeStatus('status').notNull().default('PENDING'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    expiringNotifiedAt: timestamp('expiring_notified_at', { withTimezone: true }),
    // Not unique: one team game can complete several pair challenges.
    gameId: uuid('game_id').references(() => games.id, { onDelete: 'set null' }),
    winnerUserId: uuid('winner_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('challenges_distinct_players_check', sql`${t.challengerUserId} <> ${t.opponentUserId}`),
    check(
      'challenges_canonical_pair_check',
      sql`${t.pairLowUserId} = least(${t.challengerUserId}, ${t.opponentUserId}) and ${t.pairHighUserId} = greatest(${t.challengerUserId}, ${t.opponentUserId})`,
    ),
    check('challenges_deadline_check', sql`${t.deadlineAt} > ${t.createdAt}`),
    check(
      'challenges_accepted_at_check',
      sql`${t.status} not in ('ACCEPTED', 'COMPLETED') or ${t.acceptedAt} is not null`,
    ),
    check(
      'challenges_resolved_at_check',
      sql`(${t.status} in ('PENDING', 'ACCEPTED')) = (${t.resolvedAt} is null)`,
    ),
    check(
      'challenges_completed_winner_check',
      sql`${t.status} <> 'COMPLETED' or ${t.winnerUserId} is not null`,
    ),
    uniqueIndex('challenges_active_pair_unique')
      .on(t.tournamentId, t.pairLowUserId, t.pairHighUserId)
      .where(sql`${t.status} in ('PENDING', 'ACCEPTED')`),
    index('challenges_status_deadline_idx').on(t.status, t.deadlineAt, t.id),
    index('challenges_challenger_created_idx').on(t.challengerUserId, t.createdAt.desc(), t.id),
    index('challenges_opponent_created_idx').on(t.opponentUserId, t.createdAt.desc(), t.id),
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

export const notificationCategory = pgEnum('notification_category', [
  'games',
  'challenges',
  'achievements',
  'claims',
  'groups',
]);

export const notificationType = pgEnum('notification_type', [
  'game_recorded',
  'challenge_received',
  'challenge_accepted',
  'challenge_declined',
  'challenge_expiring',
  'challenge_expired',
  'achievement_unlocked',
  'placeholder_claimed',
  'group_member_joined',
]);

/**
 * In-app inbox. Rows are always inserted regardless of preferences; dedupe_key (event identity)
 * makes repeated event emission for the same recipient a no-op.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    type: notificationType('type').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
    gameId: uuid('game_id').references(() => games.id, { onDelete: 'set null' }),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    challengeId: uuid('challenge_id').references((): AnyPgColumn => challenges.id, {
      onDelete: 'set null',
    }),
    achievementCode: text('achievement_code'),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    unique('notifications_recipient_dedupe_unique').on(t.recipientUserId, t.dedupeKey),
    index('notifications_recipient_created_idx').on(
      t.recipientUserId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('notifications_recipient_unread_idx')
      .on(t.recipientUserId)
      .where(sql`${t.readAt} is null`),
  ],
);

/** Push-only toggles per category; a missing row means every category is enabled. */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  gamesEnabled: boolean('games_enabled').notNull().default(true),
  challengesEnabled: boolean('challenges_enabled').notNull().default(true),
  achievementsEnabled: boolean('achievements_enabled').notNull().default(true),
  claimsEnabled: boolean('claims_enabled').notNull().default(true),
  groupsEnabled: boolean('groups_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const achievementSource = pgEnum('achievement_source', [
  'GAME',
  'CHALLENGE',
  'GROUP',
  'CLAIM',
  'BACKFILL',
]);

/** Badges earned once per user and code; they survive deletion of whatever earned them. */
export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementCode: text('achievement_code').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
    sourceType: achievementSource('source_type').notNull(),
    sourceGameId: uuid('source_game_id').references(() => games.id, { onDelete: 'set null' }),
    sourceGroupId: uuid('source_group_id').references(() => groups.id, { onDelete: 'set null' }),
    sourceChallengeId: uuid('source_challenge_id').references((): AnyPgColumn => challenges.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    primaryKey({ name: 'user_achievements_pk', columns: [t.userId, t.achievementCode] }),
    index('user_achievements_user_unlocked_idx').on(
      t.userId,
      t.unlockedAt.desc(),
      t.achievementCode,
    ),
    check(
      'user_achievements_code_check',
      sql.raw(`achievement_code in (${ACHIEVEMENT_CODES.map((c) => `'${c}'`).join(', ')})`),
    ),
  ],
);

export const pushPlatform = pgEnum('push_platform', ['IOS', 'ANDROID', 'UNKNOWN']);

/** One row per app installation; an Expo token has exactly one owner at a time. */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installationId: text('installation_id').notNull(),
    expoToken: text('expo_token').notNull().unique(),
    platform: pushPlatform('platform').notNull().default('UNKNOWN'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('push_devices_user_installation_unique').on(t.userId, t.installationId),
    index('push_devices_active_user_idx')
      .on(t.userId)
      .where(sql`${t.disabledAt} is null`),
    check(
      'push_devices_installation_id_length_check',
      sql`char_length(${t.installationId}) between 1 and 200`,
    ),
  ],
);
