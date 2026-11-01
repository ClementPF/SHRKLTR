import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import {
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

// Trimming before min(1) guarantees a non-empty slug once whitespace is stripped.
const displayNameSchema = z.string().trim().min(1).max(100);

const createTournamentSchema = z
  .object({
    displayName: displayNameSchema,
    sportName: z.string().trim().min(1).max(100),
  })
  .meta({ id: 'CreateTournamentRequest' });

const updateTournamentSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    isOver: z.boolean().optional(),
  })
  .refine((b) => b.displayName !== undefined || b.isOver !== undefined, {
    message: 'Provide displayName and/or isOver',
  })
  .meta({ id: 'UpdateTournamentRequest' });

const nameParamsSchema = z.object({ name: z.string().min(1) });

const listQuerySchema = z.object({
  sport: z.string().optional().describe('Sport name filter; empty or absent returns all'),
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
          'creates the sport. A duplicate derived name is rejected with 400.',
        security,
        body: createTournamentSchema,
        response: { 201: tournamentDtoSchema, 400: errorResponseSchema, 401: errorResponseSchema },
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
        summary: 'Update a tournament in place (owner only)',
        description: 'A new displayName regenerates the URL name; the id never changes.',
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
        summary: 'Delete a tournament and all its games and stats (owner only)',
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
};
