import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { sportDtoSchema, toSportDto } from '../lib/serializers.js';
import { createSport, listSports } from '../services/sport.service.js';

const createSportSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .meta({ id: 'CreateSportRequest' });

const security = [{ bearerAuth: [] }];

export const sportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/sports',
    {
      schema: {
        tags: ['sports'],
        summary: 'List all sports',
        security,
        response: { 200: z.array(sportDtoSchema), 401: errorResponseSchema },
      },
    },
    async () => (await listSports(app.db)).map(toSportDto),
  );

  app.post(
    '/sports',
    {
      schema: {
        tags: ['sports'],
        summary: 'Create a sport',
        description: 'Sport names are unique; a duplicate name is rejected with 400.',
        security,
        body: createSportSchema,
        response: { 201: sportDtoSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const sport = await createSport(app.db, request.body.name);
      if (!sport) {
        throw ApiError.badRequest(
          `Sport "${request.body.name}" already exists`,
          'SPORT_ALREADY_EXISTS',
        );
      }
      return reply.code(201).send(toSportDto(sport));
    },
  );
};
