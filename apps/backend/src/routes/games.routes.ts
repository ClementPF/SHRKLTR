import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { errorResponseSchema } from '../lib/errors.js';
import { gameDtoSchema, toGameDto } from '../lib/serializers.js';
import { getGame } from '../services/game-history.service.js';

const gameParamsSchema = z.object({ id: z.uuid() });

const security = [{ bearerAuth: [] }];

export const gameRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/games/:id',
    {
      schema: {
        tags: ['games'],
        summary: 'Game detail with tournament, outcomes, Elo deltas and pre-game ratings',
        description:
          'outcomes[].scoreValue is the signed Elo change; ratingBefore is the tournament ' +
          'rating just before the game, or null for games recorded before it was tracked.',
        security,
        params: gameParamsSchema,
        response: {
          200: gameDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => toGameDto(await getGame(app.db, request.params.id, request.user.id)),
  );
};
