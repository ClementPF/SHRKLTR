import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from '@fastify/type-provider-zod';
import { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string, code = 'BAD_REQUEST') {
    return new ApiError(400, code, message);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }
}

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function errorBody(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

const codeByStatus: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'TOO_MANY_REQUESTS',
};

function isFastifyClientError(err: unknown): err is FastifyError & { statusCode: number } {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) return false;
  const { statusCode } = err as { statusCode: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

/**
 * Fastify's `frameworkErrors` option: errors raised before routing (e.g. FST_ERR_BAD_URL for
 * an undecodable path) never reach setErrorHandler, so they are enveloped here instead.
 */
export function frameworkErrorHandler(
  err: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (isFastifyClientError(err)) {
    const code = codeByStatus[err.statusCode] ?? 'REQUEST_ERROR';
    void reply.code(err.statusCode).send(errorBody(code, err.message));
    return;
  }
  request.log.error({ err }, 'framework error');
  void reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
}

// @fastify/cors replies to strict-preflight failures directly from its onRequest hook with this
// exact text/plain body, bypassing the error handler.
const CORS_INVALID_PREFLIGHT_BODY = 'Invalid Preflight Request';

export function registerErrorHandling(app: FastifyInstance): void {
  // Must be added before @fastify/cors registers its OPTIONS route so the hook applies to it.
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      request.method === 'OPTIONS' &&
      reply.statusCode === 400 &&
      payload === CORS_INVALID_PREFLIGHT_BODY
    ) {
      reply.type('application/json; charset=utf-8');
      return JSON.stringify(errorBody('BAD_REQUEST', 'Invalid CORS preflight request'));
    }
    return payload;
  });

  app.setErrorHandler((err, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send(errorBody('VALIDATION_ERROR', err.message));
    }
    if (err instanceof ApiError) {
      return reply.code(err.status).send(errorBody(err.code, err.message));
    }
    if (isResponseSerializationError(err)) {
      request.log.error({ err }, 'response failed schema serialization');
      return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
    }
    if (isFastifyClientError(err)) {
      const code = codeByStatus[err.statusCode] ?? 'REQUEST_ERROR';
      return reply.code(err.statusCode).send(errorBody(code, err.message));
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(
        errorBody('NOT_FOUND', `Route ${request.method} ${request.url.split('?')[0]} not found`),
      );
  });
}
