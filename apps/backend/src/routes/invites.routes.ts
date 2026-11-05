import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { errorResponseSchema } from '../lib/errors.js';
import {
  appInviteDtoSchema,
  appInvitePreviewDtoSchema,
  claimPreviewDtoSchema,
  toClaimPreviewDto,
} from '../lib/invite-serializers.js';
import { toUserDto } from '../lib/serializers.js';
import { issueAppInvite, previewAppInvite } from '../services/invite.service.js';
import { previewClaim } from '../services/placeholder.service.js';

const tokenParamsSchema = z.object({ token: z.string().min(1).max(200) });

// Clients may POST with no body at all, which Fastify hands over as null.
const emptyBodySchema = z.object({}).nullish();

const security = [{ bearerAuth: [] }];

/** Capability previews must not be indexed or cached by shared caches. */
function markPrivateCapability(reply: FastifyReply): void {
  reply.header('x-robots-tag', 'noindex, nofollow');
  reply.header('cache-control', 'no-store');
}

/**
 * Claim and app invitation links. The previews are public (no blanket auth hook); only issuing
 * an app invitation requires a session.
 */
export const inviteRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/invites/claim/:token',
    {
      schema: {
        tags: ['invites'],
        summary: 'Public preview of a placeholder claim link',
        description:
          'Does not consume the link. Only a Google account that is new to Sharkulator can ' +
          'claim it. Unknown, expired, revoked and used links answer 404 CLAIM_INVALID.',
        params: tokenParamsSchema,
        response: { 200: claimPreviewDtoSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      markPrivateCapability(reply);
      return toClaimPreviewDto(await previewClaim(app.db, request.params.token, app.clock()));
    },
  );

  app.post(
    '/invites/app',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['invites'],
        summary: 'Issue (or rotate) the caller’s reusable Sharkulator invitation link',
        description:
          'Each user has one link with no automatic expiry. Issuing again invalidates the ' +
          'previous URL. The URL is returned only in this response.',
        security,
        body: emptyBodySchema,
        response: { 201: appInviteDtoSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const invite = await issueAppInvite(
        app.db,
        request.user.id,
        app.config.PUBLIC_WEB_URL,
        app.clock(),
      );
      return reply.code(201).send(invite);
    },
  );

  app.get(
    '/invites/app/:token',
    {
      schema: {
        tags: ['invites'],
        summary: 'Public preview of a general Sharkulator invitation link',
        description: 'Does not consume the link and never claims a player.',
        params: tokenParamsSchema,
        response: { 200: appInvitePreviewDtoSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      markPrivateCapability(reply);
      const { invitedBy } = await previewAppInvite(app.db, request.params.token);
      return { invitedBy: toUserDto(invitedBy) };
    },
  );
};
