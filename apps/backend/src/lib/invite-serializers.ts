import { z } from 'zod';
import type {
  ClaimPreview,
  IssuedClaimLink,
  InvitedPlayer,
} from '../services/placeholder.service.js';
import {
  gameDtoSchema,
  statsDtoSchema,
  toGameDto,
  toStatsDto,
  toUserDto,
  userDtoSchema,
} from './serializers.js';

export const claimLinkDtoSchema = z
  .object({
    user: userDtoSchema,
    claimUrl: z.url().describe('One-time claim link; returned only when issued, never stored'),
    claimExpiresAt: z.iso.datetime(),
  })
  .meta({ id: 'PlaceholderClaimLink' });

export function toClaimLinkDto(issued: IssuedClaimLink): z.infer<typeof claimLinkDtoSchema> {
  return {
    user: toUserDto(issued.user),
    claimUrl: issued.claimUrl,
    claimExpiresAt: issued.claimExpiresAt.toISOString(),
  };
}

export const invitedPlayerDtoSchema = z
  .object({
    user: userDtoSchema,
    status: z
      .enum(['ACTIVE', 'EXPIRED', 'REVOKED', 'CLAIMED'])
      .describe('Lifecycle of the current claim link'),
    claimExpiresAt: z.iso.datetime(),
    claimRevokedAt: z.iso.datetime().nullable(),
    claimedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'InvitedPlayer' });

export function toInvitedPlayerDto(row: InvitedPlayer): z.infer<typeof invitedPlayerDtoSchema> {
  return {
    user: toUserDto(row.user),
    status: row.status,
    claimExpiresAt: row.claimExpiresAt.toISOString(),
    claimRevokedAt: row.claimRevokedAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
  };
}

export const claimPreviewDtoSchema = z
  .object({
    player: userDtoSchema,
    invitedBy: userDtoSchema.nullable(),
    expiresAt: z.iso.datetime(),
    gamesCount: z.int().describe('Games played in open tournaments'),
    recentGames: z.array(gameDtoSchema).describe('Most recent open-tournament games'),
    stats: z.array(statsDtoSchema).describe('Ratings in open tournaments'),
  })
  .meta({ id: 'ClaimPreview' });

export function toClaimPreviewDto(preview: ClaimPreview): z.infer<typeof claimPreviewDtoSchema> {
  return {
    player: toUserDto(preview.player),
    invitedBy: preview.invitedBy ? toUserDto(preview.invitedBy) : null,
    expiresAt: preview.expiresAt.toISOString(),
    gamesCount: preview.gamesCount,
    recentGames: preview.recentGames.map(toGameDto),
    stats: preview.stats.map(toStatsDto),
  };
}

export const appInviteDtoSchema = z
  .object({ url: z.url().describe('Reusable invitation link; returned only when issued') })
  .meta({ id: 'AppInvite' });

export const appInvitePreviewDtoSchema = z
  .object({ invitedBy: userDtoSchema })
  .meta({ id: 'AppInvitePreview' });
