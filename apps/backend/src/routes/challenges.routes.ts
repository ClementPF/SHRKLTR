import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { challengeStatus } from '../db/schema.js';
import { challengeDtoSchema, toChallengeDto } from '../lib/challenge-serializers.js';
import { errorResponseSchema } from '../lib/errors.js';
import { pageQuerySchema, parsePage } from '../lib/pagination.js';
import {
  challengeExpired,
  createChallenge,
  getChallenge,
  listChallenges,
  respondToChallenge,
  type ChallengeStatus,
} from '../services/challenge.service.js';

const STATUS_LIST = new RegExp(
  `^(${challengeStatus.enumValues.join('|')})(,(${challengeStatus.enumValues.join('|')}))*$`,
);

const listQuerySchema = pageQuerySchema.extend({
  status: z
    .string()
    .regex(STATUS_LIST, 'Comma-separated challenge statuses')
    .optional()
    .describe('Only these statuses, comma-separated (e.g. PENDING,ACCEPTED)'),
});

const createChallengeSchema = z
  .strictObject({
    tournamentName: z.string().min(1).describe('Tournament (URL name) both players can see'),
    opponentUsername: z.string().min(1).describe('Registered player to challenge'),
    deadlineAt: z.iso
      .datetime({ offset: true })
      .optional()
      .describe('Between 1 hour and 30 days from now; defaults to 7 days from now'),
  })
  .meta({ id: 'CreateChallengeRequest' });

const respondSchema = z
  .strictObject({ response: z.enum(['ACCEPT', 'DECLINE']) })
  .meta({ id: 'ChallengeResponseRequest' });

const challengeParamsSchema = z.object({ id: z.uuid() });

const security = [{ bearerAuth: [] }];

export const challengeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/challenges',
    {
      schema: {
        tags: ['challenges'],
        summary: 'Your challenges, sent and received, newest first',
        description:
          'Paginated with zero-based page (default 0) and pageSize (default 20, max 100). Only ' +
          'challenges of tournaments you can currently see.',
        security,
        querystring: listQuerySchema,
        response: {
          200: z.array(challengeDtoSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { status, ...page } = request.query;
      const statuses = status ? (status.split(',') as ChallengeStatus[]) : undefined;
      const views = await listChallenges(app.db, request.user.id, { statuses }, parsePage(page));
      return views.map(toChallengeDto);
    },
  );

  app.post(
    '/challenges',
    {
      schema: {
        tags: ['challenges'],
        summary: 'Challenge a registered player in a tournament',
        description:
          'Creates a PENDING challenge and notifies the opponent (challenge_received). Errors: ' +
          'SELF_CHALLENGE, OPPONENT_NOT_REGISTERED, INVALID_DEADLINE, ACTIVE_CHALLENGE_EXISTS ' +
          '(one PENDING/ACCEPTED challenge per pair and tournament, either direction), ' +
          'PLAYER_NOT_GROUP_MEMBER (opponent outside the private group); an unknown or invisible ' +
          'tournament or user is 404.',
        security,
        body: createChallengeSchema,
        response: {
          201: challengeDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { view, notificationIds } = await createChallenge(
        app.db,
        {
          callerId: request.user.id,
          tournamentName: request.body.tournamentName,
          opponentUsername: request.body.opponentUsername,
          deadlineAt:
            request.body.deadlineAt === undefined ? undefined : new Date(request.body.deadlineAt),
        },
        app.clock(),
      );
      app.push.dispatch(notificationIds);
      return reply.code(201).send(toChallengeDto(view));
    },
  );

  app.get(
    '/challenges/:id',
    {
      schema: {
        tags: ['challenges'],
        summary: 'One of your challenges',
        description: "Other players' challenges and invisible tournaments answer 404.",
        security,
        params: challengeParamsSchema,
        response: {
          200: challengeDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      toChallengeDto(await getChallenge(app.db, request.params.id, request.user.id)),
  );

  app.put(
    '/challenges/:id/response',
    {
      schema: {
        tags: ['challenges'],
        summary: 'Accept or decline a challenge you received',
        description:
          'Only the opponent may answer (403 NOT_CHALLENGE_OPPONENT). Repeating the answer ' +
          'already given returns the challenge unchanged; any other answer to an answered ' +
          'challenge is 400 CHALLENGE_NOT_PENDING, and a challenge past its deadline is 400 ' +
          'CHALLENGE_EXPIRED.',
        security,
        params: challengeParamsSchema,
        body: respondSchema,
        response: {
          200: challengeDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const result = await respondToChallenge(
        app.db,
        {
          challengeId: request.params.id,
          callerId: request.user.id,
          response: request.body.response,
        },
        app.clock,
      );
      app.push.dispatch(result.notificationIds);
      if (result.expired) throw challengeExpired();
      return toChallengeDto(result.view);
    },
  );
};
