import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { ACHIEVEMENTS } from '../achievements/catalog.js';
import {
  achievementDtoSchema,
  achievementUnlockDtoSchema,
  toAchievementDto,
  toAchievementUnlockDtos,
  toUserAchievementDtos,
  userAchievementDtoSchema,
} from '../lib/achievement-serializers.js';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { pageQuerySchema, parsePage } from '../lib/pagination.js';
import { listRecentUnlocks, listUnlocks } from '../services/achievement.service.js';
import { findUserById, requireVisibleUser } from '../services/user.service.js';

const security = [{ bearerAuth: [] }];

const recentQuerySchema = pageQuerySchema.extend({
  pageSize: pageQuerySchema.shape.pageSize.default(5),
});

export const achievementRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/achievements',
    {
      schema: {
        tags: ['achievements'],
        summary: 'Catalog of every achievement, in display order',
        security,
        response: { 200: z.array(achievementDtoSchema), 401: errorResponseSchema },
      },
    },
    async () => ACHIEVEMENTS.map(toAchievementDto),
  );

  app.get(
    '/achievements/recent',
    {
      schema: {
        tags: ['achievements'],
        summary: 'Your most recent badge unlocks, newest first (personal feed)',
        description:
          "Only the authenticated user's own unlocks. Zero-based page (default 0) and pageSize " +
          '(default 5, max 100).',
        security,
        querystring: recentQuerySchema,
        response: {
          200: z.array(achievementUnlockDtoSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const viewer = await findUserById(app.db, request.user.id);
      if (!viewer) {
        throw ApiError.unauthorized('Authenticated user no longer exists', 'USER_NOT_FOUND');
      }
      const unlocks = await listRecentUnlocks(app.db, viewer, parsePage(request.query));
      return toAchievementUnlockDtos(viewer, unlocks);
    },
  );

  app.get(
    '/users/:username/achievements',
    {
      schema: {
        tags: ['achievements'],
        summary: 'Every achievement with its locked/unlocked state for a user',
        description:
          'The full catalog in display order; unlocked entries carry unlockedAt and their ' +
          'source. A source game you cannot see is reported as null.',
        security,
        params: z.object({ username: z.string().min(1) }),
        response: {
          200: z.array(userAchievementDtoSchema),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await requireVisibleUser(app.db, request.params.username, request.user.id);
      return toUserAchievementDtos(await listUnlocks(app.db, request.user.id, user.id));
    },
  );
};
