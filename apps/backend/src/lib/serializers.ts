import { z } from 'zod';
import type { users } from '../db/schema.js';

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
