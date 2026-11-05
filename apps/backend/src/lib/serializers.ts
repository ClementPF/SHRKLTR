import { z } from 'zod';
import type {
  games,
  outcomes,
  rivalryStats,
  sports,
  stats,
  tournaments,
  users,
} from '../db/schema.js';

export const userDtoSchema = z
  .object({
    id: z.uuid(),
    username: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    pictureUrl: z.string().nullable(),
    locale: z.string().nullable(),
  })
  .meta({ id: 'User' });

export type UserDto = z.infer<typeof userDtoSchema>;

type UserRow = typeof users.$inferSelect;

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    pictureUrl: row.pictureUrl,
    locale: row.locale,
  };
}

export const sportDtoSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
  })
  .meta({ id: 'Sport' });

export type SportDto = z.infer<typeof sportDtoSchema>;

type SportRow = typeof sports.$inferSelect;

export function toSportDto(row: SportRow): SportDto {
  return { id: row.id, name: row.name };
}

export const tournamentDtoSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    displayName: z.string(),
    isOver: z.boolean(),
    sport: sportDtoSchema,
    owner: userDtoSchema.nullable(),
  })
  .meta({ id: 'Tournament' });

export type TournamentDto = z.infer<typeof tournamentDtoSchema>;

export function toTournamentDto(row: {
  tournament: typeof tournaments.$inferSelect;
  sport: SportRow;
  owner: UserRow | null;
}): TournamentDto {
  return {
    id: row.tournament.id,
    name: row.tournament.name,
    displayName: row.tournament.displayName,
    isOver: row.tournament.isOver,
    sport: toSportDto(row.sport),
    owner: row.owner ? toUserDto(row.owner) : null,
  };
}

export const outcomeDtoSchema = z
  .object({
    id: z.uuid(),
    result: z.enum(['WIN', 'TIE', 'LOSS']),
    scoreValue: z.number().describe('Signed Elo change from this game'),
    ratingBefore: z
      .number()
      .nullable()
      .describe('Tournament rating just before the game; null for games recorded before tracking'),
    user: userDtoSchema,
  })
  .meta({ id: 'Outcome' });

export type OutcomeDto = z.infer<typeof outcomeDtoSchema>;

export function toOutcomeDto(row: {
  outcome: typeof outcomes.$inferSelect;
  user: UserRow;
}): OutcomeDto {
  return {
    id: row.outcome.id,
    result: row.outcome.result,
    scoreValue: row.outcome.scoreValue,
    ratingBefore: row.outcome.ratingBefore,
    user: toUserDto(row.user),
  };
}

export const gameDtoSchema = z
  .object({
    id: z.uuid(),
    date: z.iso.datetime(),
    tournament: tournamentDtoSchema,
    outcomes: z.array(outcomeDtoSchema),
  })
  .meta({ id: 'Game' });

export type GameDto = z.infer<typeof gameDtoSchema>;

export function toGameDto(row: {
  game: typeof games.$inferSelect;
  tournament: Parameters<typeof toTournamentDto>[0];
  outcomes: Parameters<typeof toOutcomeDto>[0][];
}): GameDto {
  return {
    id: row.game.id,
    date: row.game.date.toISOString(),
    tournament: toTournamentDto(row.tournament),
    outcomes: row.outcomes.map(toOutcomeDto),
  };
}

const statFields = {
  score: z.number(),
  bestScore: z.number(),
  worstScore: z.number(),
  gameCount: z.int(),
  winCount: z.int(),
  loseCount: z.int(),
  tieCount: z.int(),
  winStreak: z.int(),
  loseStreak: z.int(),
  tieStreak: z.int(),
  longestWinStreak: z.int(),
  longestLoseStreak: z.int(),
  longestTieStreak: z.int(),
};

type StatColumns = Pick<
  typeof stats.$inferSelect,
  | 'score'
  | 'bestScore'
  | 'worstScore'
  | 'gameCount'
  | 'winCount'
  | 'loseCount'
  | 'tieCount'
  | 'winStreak'
  | 'loseStreak'
  | 'tieStreak'
  | 'longuestWinStreak'
  | 'longuestLoseStreak'
  | 'longuestTieStreak'
>;

// The DB keeps the legacy "longuest" column spelling; it never reaches the wire.
function toStatFields(row: StatColumns) {
  return {
    score: row.score,
    bestScore: row.bestScore,
    worstScore: row.worstScore,
    gameCount: row.gameCount,
    winCount: row.winCount,
    loseCount: row.loseCount,
    tieCount: row.tieCount,
    winStreak: row.winStreak,
    loseStreak: row.loseStreak,
    tieStreak: row.tieStreak,
    longestWinStreak: row.longuestWinStreak,
    longestLoseStreak: row.longuestLoseStreak,
    longestTieStreak: row.longuestTieStreak,
  };
}

export const rivalryStatsDtoSchema = z
  .object({
    id: z.uuid(),
    user: userDtoSchema,
    rival: userDtoSchema,
    tournament: tournamentDtoSchema,
    ...statFields,
  })
  .meta({ id: 'RivalryStats' });

export type RivalryStatsDto = z.infer<typeof rivalryStatsDtoSchema>;

export function toRivalryStatsDto(row: {
  rivalry: typeof rivalryStats.$inferSelect;
  user: UserRow;
  rival: UserRow;
  tournament: Parameters<typeof toTournamentDto>[0];
}): RivalryStatsDto {
  return {
    id: row.rivalry.id,
    user: toUserDto(row.user),
    rival: toUserDto(row.rival),
    tournament: toTournamentDto(row.tournament),
    ...toStatFields(row.rivalry),
  };
}

export const statsDtoSchema = z
  .object({
    id: z.uuid(),
    user: userDtoSchema,
    tournament: tournamentDtoSchema,
    ...statFields,
    bestRivalry: rivalryStatsDtoSchema.nullable(),
    worstRivalry: rivalryStatsDtoSchema.nullable(),
  })
  .meta({ id: 'Stats' });

export type StatsDto = z.infer<typeof statsDtoSchema>;

export function toStatsDto(row: {
  stats: typeof stats.$inferSelect;
  user: UserRow;
  tournament: Parameters<typeof toTournamentDto>[0];
  bestRivalry: Parameters<typeof toRivalryStatsDto>[0] | null;
  worstRivalry: Parameters<typeof toRivalryStatsDto>[0] | null;
}): StatsDto {
  return {
    id: row.stats.id,
    user: toUserDto(row.user),
    tournament: toTournamentDto(row.tournament),
    ...toStatFields(row.stats),
    bestRivalry: row.bestRivalry ? toRivalryStatsDto(row.bestRivalry) : null,
    worstRivalry: row.worstRivalry ? toRivalryStatsDto(row.worstRivalry) : null,
  };
}
