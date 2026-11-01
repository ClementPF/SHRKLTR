import { z } from 'zod';
import type { games, outcomes, sports, tournaments, users } from '../db/schema.js';

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
    scoreValue: z.number(),
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
