import { z } from 'zod';
import { challengeStatus } from '../db/schema.js';
import type { ChallengeView } from '../services/challenge.service.js';
import { toTournamentDto, toUserDto, tournamentDtoSchema, userDtoSchema } from './serializers.js';

export const challengeStatusSchema = z.enum(challengeStatus.enumValues).meta({
  id: 'ChallengeStatus',
  description:
    'PENDING until the opponent answers; ACCEPTED until a qualifying game (COMPLETED) or the ' +
    'deadline (EXPIRED); DECLINED, COMPLETED and EXPIRED are final',
});

export const challengeDtoSchema = z
  .object({
    id: z.uuid(),
    tournament: tournamentDtoSchema,
    challenger: userDtoSchema,
    opponent: userDtoSchema,
    status: challengeStatusSchema,
    deadlineAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().nullable(),
    resolvedAt: z.iso.datetime().nullable().describe('When it was declined, completed or expired'),
    winner: userDtoSchema.nullable().describe('Challenged player on the winning team (COMPLETED)'),
    gameId: z
      .uuid()
      .nullable()
      .describe('Game that completed the challenge; null otherwise or once that game is deleted'),
  })
  .meta({ id: 'Challenge' });

export type ChallengeDto = z.infer<typeof challengeDtoSchema>;

export function toChallengeDto(view: ChallengeView): ChallengeDto {
  const { challenge } = view;
  return {
    id: challenge.id,
    tournament: toTournamentDto(view.tournament),
    challenger: toUserDto(view.challenger),
    opponent: toUserDto(view.opponent),
    status: challenge.status,
    deadlineAt: challenge.deadlineAt.toISOString(),
    createdAt: challenge.createdAt.toISOString(),
    acceptedAt: challenge.acceptedAt ? challenge.acceptedAt.toISOString() : null,
    resolvedAt: challenge.resolvedAt ? challenge.resolvedAt.toISOString() : null,
    winner: view.winner ? toUserDto(view.winner) : null,
    gameId: challenge.gameId,
  };
}
