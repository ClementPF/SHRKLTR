import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { SHARE_CARD_TEMPLATE_VERSION } from '../lib/share-renderer.js';
import { renderSharePage, SHARE_NOT_FOUND_PAGE } from '../lib/share-page.js';
import {
  findPublicShare,
  issueShare,
  revokeShare,
  shareUrls,
  type PublicShare,
} from '../services/share.service.js';

const security = [{ bearerAuth: [] }];

// Clients may POST with no body at all, which Fastify hands over as null.
const emptyBodySchema = z.object({}).nullish();

export const gameShareDtoSchema = z
  .object({
    shareId: z.uuid(),
    url: z.url().describe('Public result page: PUBLIC_API_URL/s/<token>'),
    imageUrl: z.url().describe('1200×630 PNG card: PUBLIC_API_URL/s/<token>.png'),
  })
  .meta({ id: 'GameShare' });

/** Issuing and revoking public result links; both need a session. */
export const shareRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/games/:id/share',
    {
      schema: {
        tags: ['shares'],
        summary: 'Get or create my public link for a game I played in',
        description:
          'Anyone with the link can see this result, including results of members-only ' +
          'tournaments. Returns 201 when a link is issued and 200 with the same link while ' +
          'the caller’s previous one is still active. The result is fixed at issuance.',
        security,
        params: z.object({ id: z.uuid() }),
        body: emptyBodySchema,
        response: {
          200: gameShareDtoSchema,
          201: gameShareDtoSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { share, created } = await issueShare(app.db, {
        gameId: request.params.id,
        userId: request.user.id,
        now: app.clock(),
      });
      return reply
        .code(created ? 201 : 200)
        .send({ shareId: share.id, ...shareUrls(app.config.PUBLIC_API_URL, share.token) });
    },
  );

  app.delete(
    '/games/:id/share/:shareId',
    {
      schema: {
        tags: ['shares'],
        summary: 'Revoke my public link',
        description:
          'Only the issuer can revoke, even without current access to the game. The page and ' +
          'image answer 404 afterwards; previews already shown in messaging apps stay.',
        security,
        params: z.object({ id: z.uuid(), shareId: z.uuid() }),
        response: {
          204: z.null(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await revokeShare(app.db, {
        gameId: request.params.id,
        shareId: request.params.shareId,
        userId: request.user.id,
        now: app.clock(),
      });
      return reply.code(204).send(null);
    },
  );
};

const tokenParamsSchema = z.object({ token: z.string().max(200) });

function cacheKey(share: PublicShare): string {
  const digest = createHash('sha256').update(JSON.stringify(share.snapshot)).digest('hex');
  return `${share.id}:${share.templateVersion}:${SHARE_CARD_TEMPLATE_VERSION}:${digest}`;
}

function wantsHtml(accept: string | undefined): boolean {
  return accept !== undefined && accept.includes('text/html');
}

/**
 * Public result page and image (no authentication). The share is looked up on every request,
 * before any cached image is returned, so revocation takes effect immediately.
 */
export const publicShareRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow, noarchive');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
  });

  const imageOrigin = new URL(app.config.PUBLIC_API_URL).origin;
  const pageCsp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src 'self' ${imageOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  app.get(
    '/s/:token',
    {
      schema: {
        tags: ['shares'],
        summary: 'Public result page (HTML with Open Graph preview tags)',
        description:
          'Unknown or revoked links answer 404: an HTML page for browsers, otherwise ' +
          'SHARE_NOT_FOUND JSON.',
        params: tokenParamsSchema,
      },
    },
    async (request, reply) => {
      let share: PublicShare;
      try {
        share = await findPublicShare(app.db, request.params.token);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404 && wantsHtml(request.headers.accept)) {
          return reply.code(404).type('text/html; charset=utf-8').send(SHARE_NOT_FOUND_PAGE);
        }
        throw err;
      }
      const { url, imageUrl } = shareUrls(app.config.PUBLIC_API_URL, request.params.token);
      const html = renderSharePage({
        snapshot: share.snapshot,
        pageUrl: url,
        imageUrl,
        appUrl: `${app.config.PUBLIC_WEB_URL}/games/${share.snapshot.gameId}`,
      });
      return reply
        .type('text/html; charset=utf-8')
        .header('content-security-policy', pageCsp)
        .send(html);
    },
  );

  app.get(
    '/s/:token.png',
    {
      schema: {
        tags: ['shares'],
        summary: 'Public 1200×630 PNG result card',
        description:
          'image/png. Unknown or revoked links answer 404 SHARE_NOT_FOUND; a rendering ' +
          'failure answers 503 SHARE_RENDER_FAILED.',
        params: tokenParamsSchema,
      },
    },
    async (request, reply) => {
      const share = await findPublicShare(app.db, request.params.token);
      const png = await app.shareCards.get(cacheKey(share), share.snapshot);
      return reply
        .type('image/png')
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(png);
    },
  );
};
