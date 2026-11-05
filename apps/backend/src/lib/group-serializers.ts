import { z } from 'zod';
import { groupRole } from '../db/schema.js';
import type {
  GroupInviteMetadata,
  GroupJoinResult,
  IssuedGroupInvite,
} from '../services/group-invite.service.js';
import type { GroupMembership, GroupSummary, RosterEntry } from '../services/group.service.js';
import { toUserDto, userDtoSchema } from './serializers.js';

export const groupRoleSchema = z.enum(groupRole.enumValues).meta({ id: 'GroupRole' });

export const groupDtoSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    role: groupRoleSchema.describe('Your role in the group'),
    memberCount: z.int(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Group' });

export type GroupDto = z.infer<typeof groupDtoSchema>;

export function toGroupDto(summary: GroupSummary): GroupDto {
  return {
    id: summary.group.id,
    name: summary.group.name,
    role: summary.role,
    memberCount: summary.memberCount,
    createdAt: summary.group.createdAt.toISOString(),
  };
}

export const groupMemberDtoSchema = z
  .object({ user: userDtoSchema, role: groupRoleSchema, joinedAt: z.iso.datetime() })
  .meta({ id: 'GroupMember' });

export function toGroupMemberDto(row: GroupMembership): z.infer<typeof groupMemberDtoSchema> {
  return { user: toUserDto(row.user), role: row.role, joinedAt: row.joinedAt.toISOString() };
}

export const groupPlayerDtoSchema = z
  .object({
    user: userDtoSchema,
    addedBy: userDtoSchema.nullable(),
    addedAt: z.iso.datetime(),
  })
  .meta({ id: 'GroupPlayer' });

export function toGroupPlayerDto(row: RosterEntry): z.infer<typeof groupPlayerDtoSchema> {
  return {
    user: toUserDto(row.user),
    addedBy: row.addedBy ? toUserDto(row.addedBy) : null,
    addedAt: row.createdAt.toISOString(),
  };
}

export const issuedGroupInviteDtoSchema = z
  .object({
    id: z.uuid(),
    url: z.url().describe('Join link (also the QR payload); returned only when issued'),
    code: z
      .string()
      .length(10)
      .describe('Short code for manual entry, case-insensitive; returned only when issued'),
    expiresAt: z.iso.datetime().nullable().describe('Null when the invite never expires'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'IssuedGroupInvite' });

export function toIssuedGroupInviteDto(
  issued: IssuedGroupInvite,
): z.infer<typeof issuedGroupInviteDtoSchema> {
  return {
    id: issued.invite.id,
    url: issued.url,
    code: issued.code,
    expiresAt: issued.invite.expiresAt?.toISOString() ?? null,
    createdAt: issued.invite.createdAt.toISOString(),
  };
}

export const groupInviteDtoSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']),
    createdBy: userDtoSchema.nullable(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
  })
  .describe('Invite metadata; the link and code cannot be recovered')
  .meta({ id: 'GroupInvite' });

export function toGroupInviteDto(row: GroupInviteMetadata): z.infer<typeof groupInviteDtoSchema> {
  return {
    id: row.invite.id,
    status: row.status,
    createdBy: row.createdBy ? toUserDto(row.createdBy) : null,
    createdAt: row.invite.createdAt.toISOString(),
    expiresAt: row.invite.expiresAt?.toISOString() ?? null,
    revokedAt: row.invite.revokedAt?.toISOString() ?? null,
  };
}

export const groupInvitePreviewDtoSchema = z
  .object({ groupName: z.string(), expiresAt: z.iso.datetime().nullable() })
  .meta({ id: 'GroupInvitePreview' });

export const groupJoinResultDtoSchema = z
  .object({
    group: groupDtoSchema,
    role: groupRoleSchema,
    joined: z.boolean().describe('False when you were already a member; your role is unchanged'),
  })
  .meta({ id: 'GroupJoinResult' });

export function toGroupJoinResultDto(
  result: GroupJoinResult,
): z.infer<typeof groupJoinResultDtoSchema> {
  return { group: toGroupDto(result.summary), role: result.summary.role, joined: result.joined };
}
