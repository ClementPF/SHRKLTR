import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { errorResponseSchema } from '../lib/errors.js';
import {
  groupDtoSchema,
  groupInviteDtoSchema,
  groupJoinResultDtoSchema,
  groupMemberDtoSchema,
  groupPlayerDtoSchema,
  issuedGroupInviteDtoSchema,
  toGroupDto,
  toGroupInviteDto,
  toGroupJoinResultDto,
  toGroupMemberDto,
  toGroupPlayerDto,
  toIssuedGroupInviteDto,
} from '../lib/group-serializers.js';
import { pageQuerySchema, parsePage } from '../lib/pagination.js';
import { toTournamentDto, tournamentDtoSchema } from '../lib/serializers.js';
import {
  createGroupInvite,
  listGroupInvites,
  redeemGroupInvite,
  revokeGroupInvite,
} from '../services/group-invite.service.js';
import {
  addRosterPlayer,
  createGroup,
  getGroupSummary,
  leaveGroup,
  listMembers,
  listMyGroups,
  listUnclaimedPlayers,
  removeMember,
  renameGroup,
  setMemberRole,
  transferOwnership,
} from '../services/group.service.js';
import { listGroupTournaments } from '../services/tournament.service.js';

const groupNameSchema = z.string().trim().min(1).max(100);

const groupNameBodySchema = z.object({ name: groupNameSchema }).meta({ id: 'GroupNameRequest' });

const groupParamsSchema = z.object({ id: z.uuid() });
const memberParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });
const inviteParamsSchema = z.object({ id: z.uuid(), inviteId: z.uuid() });

const setRoleSchema = z
  .object({ role: z.enum(['ADMIN', 'MEMBER']) })
  .meta({ id: 'SetGroupMemberRoleRequest' });

const transferSchema = z.object({ userId: z.uuid() }).meta({ id: 'TransferGroupOwnerRequest' });

const rosterSchema = z
  .object({ placeholderUserId: z.uuid() })
  .meta({ id: 'AddGroupPlayerRequest' });

// Clients may POST with no body at all, which Fastify hands over as null.
const emptyBodySchema = z.object({}).nullish();

const createInviteSchema = z
  .object({
    expiresAt: z
      .string()
      .nullable()
      .optional()
      .describe('ISO date-time in the future; omit for the default (30 days), null for no expiry'),
  })
  .nullish()
  .meta({ id: 'CreateGroupInviteRequest' });

const joinSchema = z
  .object({
    token: z.string().min(1).max(200).optional().describe('Token from a /join/<token> link'),
    code: z.string().min(1).max(40).optional().describe('Short code, any case'),
  })
  .refine((body) => (body.token === undefined) !== (body.code === undefined), {
    message: 'Provide exactly one of token or code',
  })
  .meta({ id: 'JoinGroupRequest' });

const security = [{ bearerAuth: [] }];

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
};

export const groupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/groups',
    {
      schema: {
        tags: ['groups'],
        summary: 'Groups you belong to, with your role',
        security,
        response: { 200: z.array(groupDtoSchema), 401: errorResponseSchema },
      },
    },
    async (request) => (await listMyGroups(app.db, request.user.id)).map(toGroupDto),
  );

  app.post(
    '/groups',
    {
      schema: {
        tags: ['groups'],
        summary: 'Create a group; you become its OWNER',
        description: 'Names are trimmed, 1–100 characters, and need not be unique.',
        security,
        body: groupNameBodySchema,
        response: { 201: groupDtoSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const created = await createGroup(
        app.db,
        { creatorId: request.user.id, name: request.body.name },
        app.clock(),
      );
      app.push.dispatch(created.notificationIds);
      return reply.code(201).send(toGroupDto(created.summary));
    },
  );

  app.post(
    '/groups/join',
    {
      schema: {
        tags: ['groups'],
        summary: 'Join a group with an invite link token or short code',
        description:
          'Grants MEMBER. Joining a group you already belong to is harmless and keeps your ' +
          'role. Unknown, expired and revoked invites answer 400 INVITE_INVALID.',
        security,
        body: joinSchema,
        response: { 200: groupJoinResultDtoSchema, ...errors },
      },
    },
    async (request) => {
      const { token, code } = request.body;
      const result = await redeemGroupInvite(
        app.db,
        {
          userId: request.user.id,
          credential: token !== undefined ? { token } : { code: code ?? '' },
        },
        app.clock(),
      );
      app.push.dispatch(result.notificationIds);
      return toGroupJoinResultDto(result);
    },
  );

  app.get(
    '/groups/:id',
    {
      schema: {
        tags: ['groups'],
        summary: 'Group summary with your role (members only)',
        security,
        params: groupParamsSchema,
        response: { 200: groupDtoSchema, ...errors },
      },
    },
    async (request) =>
      toGroupDto(await getGroupSummary(app.db, request.params.id, request.user.id)),
  );

  app.put(
    '/groups/:id',
    {
      schema: {
        tags: ['groups'],
        summary: 'Rename a group (owner or admin)',
        security,
        params: groupParamsSchema,
        body: groupNameBodySchema,
        response: { 200: groupDtoSchema, ...errors },
      },
    },
    async (request) =>
      toGroupDto(
        await renameGroup(
          app.db,
          { groupId: request.params.id, callerId: request.user.id, name: request.body.name },
          app.clock(),
        ),
      ),
  );

  app.get(
    '/groups/:id/members',
    {
      schema: {
        tags: ['groups'],
        summary: 'Members with their roles: owner, then admins, then members',
        description:
          'Paginated with zero-based page (default 0) and pageSize (default 20, max 100).',
        security,
        params: groupParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: z.array(groupMemberDtoSchema), ...errors },
      },
    },
    async (request) =>
      (await listMembers(app.db, request.params.id, request.user.id, parsePage(request.query))).map(
        toGroupMemberDto,
      ),
  );

  app.put(
    '/groups/:id/members/:userId',
    {
      schema: {
        tags: ['groups'],
        summary: 'Grant or revoke ADMIN (owner only)',
        description:
          'The owner cannot be demoted directly (400 OWNER_TRANSFER_REQUIRED); transfer ' +
          'ownership instead.',
        security,
        params: memberParamsSchema,
        body: setRoleSchema,
        response: { 200: groupMemberDtoSchema, ...errors },
      },
    },
    async (request) =>
      toGroupMemberDto(
        await setMemberRole(app.db, {
          groupId: request.params.id,
          callerId: request.user.id,
          targetUserId: request.params.userId,
          role: request.body.role,
        }),
      ),
  );

  app.delete(
    '/groups/:id/members/:userId',
    {
      schema: {
        tags: ['groups'],
        summary: 'Remove a member (owner: anyone else; admin: members only)',
        security,
        params: memberParamsSchema,
        response: { 204: z.null().describe('Member removed'), ...errors },
      },
    },
    async (request, reply) => {
      await removeMember(app.db, {
        groupId: request.params.id,
        callerId: request.user.id,
        targetUserId: request.params.userId,
      });
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/groups/:id/transfer-owner',
    {
      schema: {
        tags: ['groups'],
        summary: 'Make another member the owner; you become an admin (owner only)',
        security,
        params: groupParamsSchema,
        body: transferSchema,
        response: { 200: groupDtoSchema, ...errors },
      },
    },
    async (request) =>
      toGroupDto(
        await transferOwnership(app.db, {
          groupId: request.params.id,
          callerId: request.user.id,
          targetUserId: request.body.userId,
        }),
      ),
  );

  app.post(
    '/groups/:id/leave',
    {
      schema: {
        tags: ['groups'],
        summary: 'Leave a group (the owner must transfer ownership first)',
        security,
        params: groupParamsSchema,
        body: emptyBodySchema,
        response: { 204: z.null().describe('Left the group'), ...errors },
      },
    },
    async (request, reply) => {
      await leaveGroup(app.db, { groupId: request.params.id, userId: request.user.id });
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/groups/:id/tournaments',
    {
      schema: {
        tags: ['groups'],
        summary: 'Tournaments of the group, newest first (members only)',
        description: 'Use the tournament routes for each leaderboard and history.',
        security,
        params: groupParamsSchema,
        response: { 200: z.array(tournamentDtoSchema), ...errors },
      },
    },
    async (request) => {
      await getGroupSummary(app.db, request.params.id, request.user.id);
      return (await listGroupTournaments(app.db, request.params.id)).map(toTournamentDto);
    },
  );

  app.get(
    '/groups/:id/players',
    {
      schema: {
        tags: ['groups'],
        summary: 'Unclaimed players: placeholders on the group roster',
        description: 'Claimed players are listed as members instead.',
        security,
        params: groupParamsSchema,
        response: { 200: z.array(groupPlayerDtoSchema), ...errors },
      },
    },
    async (request) =>
      (await listUnclaimedPlayers(app.db, request.params.id, request.user.id)).map(
        toGroupPlayerDto,
      ),
  );

  app.post(
    '/groups/:id/players',
    {
      schema: {
        tags: ['groups'],
        summary: 'Add an existing placeholder to the roster (its creator, owner or admin)',
        security,
        params: groupParamsSchema,
        body: rosterSchema,
        response: { 201: groupPlayerDtoSchema, ...errors },
      },
    },
    async (request, reply) => {
      const entry = await addRosterPlayer(app.db, {
        groupId: request.params.id,
        callerId: request.user.id,
        placeholderUserId: request.body.placeholderUserId,
      });
      return reply.code(201).send(toGroupPlayerDto(entry));
    },
  );

  app.get(
    '/groups/:id/invites',
    {
      schema: {
        tags: ['groups'],
        summary: 'Invite metadata (owner or admin); links and codes are never returned',
        security,
        params: groupParamsSchema,
        response: { 200: z.array(groupInviteDtoSchema), ...errors },
      },
    },
    async (request) =>
      (
        await listGroupInvites(
          app.db,
          { groupId: request.params.id, callerId: request.user.id },
          app.clock(),
        )
      ).map(toGroupInviteDto),
  );

  app.post(
    '/groups/:id/invites',
    {
      schema: {
        tags: ['groups'],
        summary: 'Issue a reusable invite link and short code (owner or admin)',
        description:
          'url and code are returned only in this response. expiresAt defaults to 30 days; ' +
          'null means no expiry; a past or malformed value is 400 INVALID_INVITE_EXPIRY.',
        security,
        params: groupParamsSchema,
        body: createInviteSchema,
        response: { 201: issuedGroupInviteDtoSchema, ...errors },
      },
    },
    async (request, reply) => {
      const issued = await createGroupInvite(
        app.db,
        {
          groupId: request.params.id,
          callerId: request.user.id,
          expiresAt: request.body?.expiresAt,
        },
        {
          publicWebUrl: app.config.PUBLIC_WEB_URL,
          ttlDays: app.config.GROUP_INVITE_TTL_DAYS,
          now: app.clock(),
        },
      );
      return reply.code(201).send(toIssuedGroupInviteDto(issued));
    },
  );

  app.delete(
    '/groups/:id/invites/:inviteId',
    {
      schema: {
        tags: ['groups'],
        summary: 'Revoke an invite (owner or admin)',
        security,
        params: inviteParamsSchema,
        response: { 204: z.null().describe('Invite revoked'), ...errors },
      },
    },
    async (request, reply) => {
      await revokeGroupInvite(
        app.db,
        {
          groupId: request.params.id,
          callerId: request.user.id,
          inviteId: request.params.inviteId,
        },
        app.clock(),
      );
      return reply.code(204).send(null);
    },
  );
};
