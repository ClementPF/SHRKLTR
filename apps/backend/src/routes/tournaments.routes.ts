import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { pageQuerySchema, parsePage } from '../lib/pagination.js';
import {
  gameDtoSchema,
  rivalryStatsDtoSchema,
  statsDtoSchema,
  toGameDto,
  toRivalryStatsDto,
  toStatsDto,
  toTournamentDto,
  toUserDto,
  tournamentDtoSchema,
  userDtoSchema,
} from '../lib/serializers.js';
import {
  createTournament,
  deleteTournament,
  findTournamentByName,
  listTournamentUsers,
  listTournaments,
  updateTournament,
} from '../services/tournament.service.js';
import { submitGame } from '../services/game.service.js';
import { listTournamentGames } from '../services/game-history.service.js';
import { listRivalries, listTournamentStats } from '../services/stats-query.service.js';

// Trimming before min(1) guarantees a non-empty slug once whitespace is stripped.
const displayNameSchema = z.string().trim().min(1).max(100);

const createTournamentSchema = z
  .object({
    displayName: displayNameSchema,
    sportName: z.string().trim().min(1).max(100),
    groupId: z
      .uuid()
      .optional()
      .describe('Creates a members-only tournament in this group (owner or admin only)'),
  })
  .meta({ id: 'CreateTournamentRequest' });

const updateTournamentSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    isOver: z.boolean().optional(),
    groupId: z.never({ error: 'The group of a tournament cannot be changed' }).optional(),
  })
  .refine((b) => b.displayName !== undefined || b.isOver !== undefined, {
    message: 'Provide displayName and/or isOver',
  })
  .meta({ id: 'UpdateTournamentRequest' });

const submitGameSchema = z
  .object({
    outcomes: z
      .array(
        z.object({
          username: z.string().min(1),
          result: z.enum(['WIN', 'TIE', 'LOSS']),
        }),
      )
      .max(100),
  })
  .meta({ id: 'SubmitGameRequest' });

const nameParamsSchema = z.object({ name: z.string().min(1) });

const listQuerySchema = z.object({
  sport: z.string().optional().describe('Sport name filter; empty or absent returns all'),
});

const rivalriesQuerySchema = z.object({
  userName: z.string().min(1).optional().describe('Only rivalries of this user'),
  rivalName: z.string().min(1).optional().describe('Only rivalries against this user'),
});

const security = [{ bearerAuth: [] }];

export const tournamentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/tournaments',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'List tournaments, most played first',
        security,
        querystring: listQuerySchema,
        response: {
          200: z.array(tournamentDtoSchema),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      (await listTournaments(app.db, { sportName: request.query.sport })).map(toTournamentDto),
  );

  app.post(
    '/tournaments',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Create a tournament owned by the caller',
        description:
          'The URL name is displayName without whitespace, lowercased. An unknown sportName ' +
          'creates the sport. A duplicate derived name is rejected with 400. With groupId the ' +
          'tournament is visible to group members only; a member who is not owner or admin ' +
          'gets 403 GROUP_ROLE_REQUIRED and a non-member 404 GROUP_NOT_FOUND.',
        security,
        body: createTournamentSchema,
        response: {
          201: tournamentDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createTournament(app.db, {
        ...request.body,
        ownerUserId: request.user.id,
      });
      return reply.code(201).send(toTournamentDto(created));
    },
  );

  app.get(
    '/tournaments/:name',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Tournament detail with owner and sport',
        security,
        params: nameParamsSchema,
        response: { 200: tournamentDtoSchema, 401: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const found = await findTournamentByName(app.db, request.params.name);
      if (!found) throw ApiError.notFound('Tournament not found', 'TOURNAMENT_NOT_FOUND');
      return toTournamentDto(found);
    },
  );

  app.put(
    '/tournaments/:name',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Update a tournament in place (creator, or group owner/admin)',
        description:
          'A new displayName regenerates the URL name; the id and group never change. Grouped ' +
          'tournaments are managed by the group owner and admins, whoever created them.',
        security,
        params: nameParamsSchema,
        body: updateTournamentSchema,
        response: {
          200: tournamentDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      toTournamentDto(
        await updateTournament(app.db, request.params.name, request.user.id, request.body),
      ),
  );

  app.delete(
    '/tournaments/:name',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Delete a tournament and its games and stats (creator, or group owner/admin)',
        security,
        params: nameParamsSchema,
        response: {
          204: z.null().describe('Tournament deleted'),
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await deleteTournament(app.db, request.params.name, request.user.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/tournaments/:name/users',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Users who have played in the tournament',
        security,
        params: nameParamsSchema,
        response: {
          200: z.array(userDtoSchema),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => (await listTournamentUsers(app.db, request.params.name)).map(toUserDto),
  );

  app.get(
    '/tournaments/:name/stats',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Tournament leaderboard, highest score first',
        security,
        params: nameParamsSchema,
        response: {
          200: z.array(statsDtoSchema),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => (await listTournamentStats(app.db, request.params.name)).map(toStatsDto),
  );

  app.get(
    '/tournaments/:name/rivalries',
    {
      schema: {
        tags: ['stats'],
        summary: 'Directional rivalries of the tournament, best score first',
        security,
        params: nameParamsSchema,
        querystring: rivalriesQuerySchema,
        response: {
          200: z.array(rivalryStatsDtoSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      (await listRivalries(app.db, { ...request.query, tournamentName: request.params.name })).map(
        toRivalryStatsDto,
      ),
  );

  app.get(
    '/tournaments/:name/games',
    {
      schema: {
        tags: ['games'],
        summary: 'Games of the tournament, newest first',
        description:
          'Paginated with zero-based page (default 0) and pageSize (default 20, max 100).',
        security,
        params: nameParamsSchema,
        querystring: pageQuerySchema,
        response: {
          200: z.array(gameDtoSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      (await listTournamentGames(app.db, request.params.name, parsePage(request.query))).map(
        toGameDto,
      ),
  );

  app.post(
    '/tournaments/:name/games',
    {
      schema: {
        tags: ['games'],
        summary: 'Record a game (submitted by a losing player)',
        description:
          'Needs as many winners as losers, no repeated player and no TIE. The caller must be ' +
          'one of the losers. In a group tournament every registered player must be a group ' +
          'member and every placeholder on its roster (400 PLAYER_NOT_GROUP_MEMBER). Date and ' +
          'outcome scores are computed by the server. Every ' +
          'participant gets a game_recorded inbox notification; push is sent after commit to ' +
          'enabled devices and push failures never fail the submission.',
        security,
        params: nameParamsSchema,
        body: submitGameSchema,
        response: {
          201: gameDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { game, notificationIds } = await submitGame(app.db, {
        tournamentName: request.params.name,
        callerId: request.user.id,
        outcomes: request.body.outcomes,
      });
      app.push.dispatch(notificationIds);
      return reply.code(201).send(toGameDto(game));
    },
  );
};
