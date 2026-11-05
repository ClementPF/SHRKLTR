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
import { listTournamentsForUser } from '../services/tournament.service.js';
import {
  findUserById,
  findUserByUsername,
  listUsers,
  updateUserProfile,
} from '../services/user.service.js';
import { challengeUser } from '../services/challenge.service.js';
import { listUserGames } from '../services/game-history.service.js';
import { listRivalries, listUserStats } from '../services/stats-query.service.js';

// Strict: username, googleSub or any other unknown key is rejected with 400 instead of being
// silently dropped, so clients learn those fields are immutable.
const updateMeSchema = z
  .strictObject({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    locale: z.string().trim().min(1).max(35).nullable().optional(),
    pictureUrl: z.url().max(2048).nullable().optional(),
  })
  .meta({ id: 'UpdateMeRequest' });

const challengeSchema = z
  .object({
    message: z.string().trim().min(1).max(500).optional(),
    challenger: z.string().min(1).optional().describe('Must be the authenticated username'),
  })
  .optional()
  .meta({ id: 'ChallengeRequest' });

const usernameParamsSchema = z.object({ username: z.string().min(1) });

const tournamentFilter = z.string().min(1).optional().describe('Only this tournament (by name)');

const userGamesQuerySchema = pageQuerySchema.extend({ tournamentName: tournamentFilter });

const security = [{ bearerAuth: [] }];

function currentUserGone(): ApiError {
  return ApiError.unauthorized('Authenticated user no longer exists', 'USER_NOT_FOUND');
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/users',
    {
      schema: {
        tags: ['users'],
        summary: 'List all users',
        security,
        response: { 200: z.array(userDtoSchema), 401: errorResponseSchema },
      },
    },
    async () => (await listUsers(app.db)).map(toUserDto),
  );

  app.get(
    '/users/me',
    {
      schema: {
        tags: ['users'],
        summary: 'Profile of the authenticated user',
        security,
        response: { 200: userDtoSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const user = await findUserById(app.db, request.user.id);
      if (!user) throw currentUserGone();
      return toUserDto(user);
    },
  );

  app.put(
    '/users/me',
    {
      schema: {
        tags: ['users'],
        summary: 'Update the authenticated user profile',
        description: 'Only firstName, lastName, locale and pictureUrl are editable.',
        security,
        body: updateMeSchema,
        response: { 200: userDtoSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const user = await updateUserProfile(app.db, request.user.id, request.body);
      if (!user) throw currentUserGone();
      return toUserDto(user);
    },
  );

  app.get(
    '/users/:username',
    {
      schema: {
        tags: ['users'],
        summary: 'Look up a user by username',
        security,
        params: usernameParamsSchema,
        response: { 200: userDtoSchema, 401: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const user = await findUserByUsername(app.db, request.params.username);
      if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
      return toUserDto(user);
    },
  );

  app.get(
    '/users/:username/tournaments',
    {
      schema: {
        tags: ['users'],
        summary: 'Tournaments the user has played in',
        description: 'Tournaments where the user has a stats row.',
        security,
        params: usernameParamsSchema,
        response: {
          200: z.array(tournamentDtoSchema),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await findUserByUsername(app.db, request.params.username);
      if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
      return (await listTournamentsForUser(app.db, user.id)).map(toTournamentDto);
    },
  );

  app.get(
    '/users/:username/stats',
    {
      schema: {
        tags: ['stats'],
        summary: 'Stats of the user in every tournament played',
        security,
        params: usernameParamsSchema,
        response: {
          200: z.array(statsDtoSchema),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => (await listUserStats(app.db, request.params.username)).map(toStatsDto),
  );

  app.get(
    '/users/:username/rivalries',
    {
      schema: {
        tags: ['stats'],
        summary: 'Rivalries of the user, best score first',
        security,
        params: usernameParamsSchema,
        querystring: z.object({ tournamentName: tournamentFilter }),
        response: {
          200: z.array(rivalryStatsDtoSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      (
        await listRivalries(app.db, {
          userName: request.params.username,
          tournamentName: request.query.tournamentName,
        })
      ).map(toRivalryStatsDto),
  );

  app.get(
    '/users/:username/games',
    {
      schema: {
        tags: ['games'],
        summary: 'Games the user played, newest first',
        description:
          'Paginated with zero-based page (default 0) and pageSize (default 20, max 100). ' +
          'An unknown tournamentName filter returns 404.',
        security,
        params: usernameParamsSchema,
        querystring: userGamesQuerySchema,
        response: {
          200: z.array(gameDtoSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { tournamentName, ...page } = request.query;
      const found = await listUserGames(
        app.db,
        request.params.username,
        { tournamentName },
        parsePage(page),
      );
      return found.map(toGameDto);
    },
  );

  app.post(
    '/users/:username/challenge',
    {
      schema: {
        tags: ['users'],
        summary: 'Challenge a user with a push notification',
        description:
          'Pushes "<firstName> is challenging you." to every active device of the target, after ' +
          'the response and best effort. The target must have an active push device.',
        security,
        params: usernameParamsSchema,
        body: challengeSchema,
        response: {
          204: z.null().describe('Challenge sent'),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await challengeUser(
        { db: app.db, push: app.push },
        {
          callerId: request.user.id,
          targetUsername: request.params.username,
          challenger: request.body?.challenger,
          message: request.body?.message,
        },
      );
      return reply.code(204).send(null);
    },
  );
};
