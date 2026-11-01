import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { toUserDto, userDtoSchema } from '../lib/serializers.js';
import {
  findUserById,
  findUserByUsername,
  listUsers,
  setPushToken,
  updateUserProfile,
} from '../services/user.service.js';

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
};
