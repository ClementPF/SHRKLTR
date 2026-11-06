import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { errorResponseSchema } from '../lib/errors.js';
import {
  rivalryStatsDtoSchema,
  statsDtoSchema,
  toRivalryStatsDto,
  toStatsDto,
} from '../lib/serializers.js';
import {
  getRivalry,
  getUserTournamentStats,
  listRivalries,
} from '../services/stats-query.service.js';

const name = z.string().min(1);

const statsQuerySchema = z.object({ userName: name, tournamentName: name });
const rivalryQuerySchema = z.object({ userName: name, rivalName: name, tournamentName: name });

const security = [{ bearerAuth: [] }];

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
};

export const statsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/stats',
    {
      schema: {
        tags: ['stats'],
        summary: 'Stats of one user in one tournament',
        description: '404 when the user or tournament is unknown or the user has not played there.',
        security,
        querystring: statsQuerySchema,
        response: { 200: statsDtoSchema, ...errors },
      },
    },
    async (request) =>
      toStatsDto(
        await getUserTournamentStats(
          app.db,
          request.query.userName,
          request.query.tournamentName,
          request.user.id,
        ),
      ),
  );

  app.get(
    '/rivalries',
    {
      schema: {
        tags: ['stats'],
        summary: 'Rivalries of one user in one tournament, best score first',
        security,
        querystring: statsQuerySchema,
        response: { 200: z.array(rivalryStatsDtoSchema), ...errors },
      },
    },
    async (request) =>
      (await listRivalries(app.db, request.query, request.user.id)).map(toRivalryStatsDto),
  );

  app.get(
    '/rivalry',
    {
      schema: {
        tags: ['stats'],
        summary: 'Directional rivalry of a user against one rival in one tournament',
        security,
        querystring: rivalryQuerySchema,
        response: { 200: rivalryStatsDtoSchema, ...errors },
      },
    },
    async (request) => toRivalryStatsDto(await getRivalry(app.db, request.query, request.user.id)),
  );
};
