import type { FastifyError, FastifyInstance } from 'fastify';
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

export function registerErrorHandling(app: FastifyInstance): void {
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
