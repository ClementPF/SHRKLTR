import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import {
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
  setPushToken,
  updateUserProfile,
} from '../services/user.service.js';
import { challengeUser } from '../services/challenge.service.js';

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

const pushTokenSchema = z
  .object({ value: z.string().trim().min(1).max(512) })
  .meta({ id: 'PushTokenRequest' });

const challengeSchema = z
  .object({
    message: z.string().trim().min(1).max(500).optional(),
    challenger: z.string().min(1).optional().describe('Must be the authenticated username'),
  })
  .optional()
  .meta({ id: 'ChallengeRequest' });

const usernameParamsSchema = z.object({ username: z.string().min(1) });

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

  app.post(
    '/users/me/push-token',
    {
      schema: {
        tags: ['users'],
        summary: 'Register the Expo push token of the authenticated user',
        description: 'One token per user; the latest registration wins.',
        security,
        body: pushTokenSchema,
        response: {
          204: z.null().describe('Token stored'),
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const stored = await setPushToken(app.db, request.user.id, request.body.value);
      if (!stored) throw currentUserGone();
      return reply.code(204).send(null);
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

  app.post(
    '/users/:username/challenge',
    {
      schema: {
        tags: ['users'],
        summary: 'Challenge a user with a push notification',
        description:
          'Sends "<firstName> is challenging you." to the target. Push delivery is best effort: ' +
          'a failed delivery still returns 204. The target must have a registered push token.',
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
        { db: app.db, pushUrl: app.config.PUSH_URL, log: request.log },
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
