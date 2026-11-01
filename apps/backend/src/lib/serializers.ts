import { z } from 'zod';
import type { sports, tournaments, users } from '../db/schema.js';

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
