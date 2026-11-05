import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { errorResponseSchema } from '../lib/errors.js';
import {
  claimLinkDtoSchema,
  invitedPlayerDtoSchema,
  toClaimLinkDto,
  toInvitedPlayerDto,
} from '../lib/invite-serializers.js';
import {
  createPlaceholder,
  listInvitedPlayers,
  reissueClaimLink,
  revokeClaimLink,
  type ClaimLinkSettings,
} from '../services/placeholder.service.js';

const createPlaceholderSchema = z
  .object({ displayName: z.string().trim().min(1).max(100) })
  .meta({ id: 'CreatePlaceholderRequest' });

const playerParamsSchema = z.object({ id: z.uuid() });

// Clients may POST with no body at all, which Fastify hands over as null.
const emptyBodySchema = z.object({}).nullish();

const security = [{ bearerAuth: [] }];

export const playerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  const claimSettings = (): ClaimLinkSettings => ({
    publicWebUrl: app.config.PUBLIC_WEB_URL,
    ttlDays: app.config.CLAIM_TTL_DAYS,
    now: app.clock(),
  });

  app.post(
    '/players/placeholders',
    {
      schema: {
        tags: ['players'],
        summary: 'Add a player by name (placeholder) and issue its one-time claim link',
        description:
          'Creates a PLACEHOLDER user that can be recorded in games right away. claimUrl is ' +
          'returned only in this response; reissue the link if it is lost.',
        security,
        body: createPlaceholderSchema,
        response: {
          201: claimLinkDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const issued = await createPlaceholder(
        app.db,
        { creatorId: request.user.id, displayName: request.body.displayName },
        claimSettings(),
      );
      return reply.code(201).send(toClaimLinkDto(issued));
    },
  );

  app.get(
    '/players/invited',
    {
      schema: {
        tags: ['players'],
        summary: 'Placeholders created by the caller with their claim status',
        description: 'Never includes claim tokens or URLs.',
        security,
        response: { 200: z.array(invitedPlayerDtoSchema), 401: errorResponseSchema },
      },
    },
    async (request) =>
      (await listInvitedPlayers(app.db, request.user.id, app.clock())).map(toInvitedPlayerDto),
  );

  app.post(
    '/players/:id/claim-link',
    {
      schema: {
        tags: ['players'],
        summary: 'Reissue the claim link of a placeholder (creator only)',
        description:
          'Rotates the link: the previous URL stops working immediately and the new one gets a ' +
          'fresh expiry. A revoked link may be reissued; a consumed one may not.',
        security,
        params: playerParamsSchema,
        body: emptyBodySchema,
        response: {
          201: claimLinkDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const issued = await reissueClaimLink(
        app.db,
        { placeholderId: request.params.id, callerId: request.user.id },
        claimSettings(),
      );
      return reply.code(201).send(toClaimLinkDto(issued));
    },
  );

  app.delete(
    '/players/:id/claim-link',
    {
      schema: {
        tags: ['players'],
        summary: 'Revoke the claim link of a placeholder (creator only)',
        security,
        params: playerParamsSchema,
        response: {
          204: z.null().describe('Link revoked'),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await revokeClaimLink(
        app.db,
        { placeholderId: request.params.id, callerId: request.user.id },
        app.clock(),
      );
      return reply.code(204).send(null);
    },
  );
};
