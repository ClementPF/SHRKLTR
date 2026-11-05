import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config.js';

export interface LogDestination {
  write(msg: string): void;
}

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
]);

export const REDACTED = '[REDACTED]';

// Header, body, and nested token fields are censored if anything ever logs them; the request
// serializer below also never includes headers in the first place.
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-dev-auth"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-dev-auth"]',
  'authorization',
  'accessToken',
  'refreshToken',
  'idToken',
  'token',
  'pushToken',
  'claimToken',
  '*.authorization',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.token',
  '*.pushToken',
  '*.claimToken',
  '*.*.claimToken',
  '*.*.accessToken',
  '*.*.refreshToken',
  '*.*.idToken',
  // Google authorization-code exchange: request fields, form params, and token-endpoint replies.
  'code',
  'codeVerifier',
  'code_verifier',
  'clientSecret',
  'client_secret',
  'id_token',
  'access_token',
  'refresh_token',
  '*.code',
  '*.codeVerifier',
  '*.code_verifier',
  '*.clientSecret',
  '*.client_secret',
  '*.id_token',
  '*.access_token',
  '*.refresh_token',
  '*.*.code',
  '*.*.codeVerifier',
  '*.*.code_verifier',
  '*.*.clientSecret',
  '*.*.client_secret',
  '*.*.id_token',
  '*.*.access_token',
  '*.*.refresh_token',
];

// Capability links carry their secret as the path segment after these prefixes.
const CAPABILITY_PATH = /^(\/invites\/(?:claim|app|group)\/)[^/?#]+/;

export function redactUrl(rawUrl: string): string {
  const url = rawUrl.replace(CAPABILITY_PATH, `$1${REDACTED}`);
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return url;
  const params = new URLSearchParams(url.slice(queryIndex + 1));
  let changed = false;
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      params.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? `${url.slice(0, queryIndex)}?${params.toString()}` : url;
}

interface SerializableRequest {
  method: string;
  url: string;
  host?: string;
  ip?: string;
}

interface SerializableReply {
  statusCode: number;
}

export function buildLoggerOptions(
  config: AppConfig,
  destination?: LogDestination,
): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: redactPaths, censor: REDACTED },
    serializers: {
      req(request: SerializableRequest) {
        return {
          method: request.method,
          url: redactUrl(request.url),
          host: request.host,
          remoteAddress: request.ip,
        };
      },
      res(reply: SerializableReply) {
        return { statusCode: reply.statusCode };
      },
    },
    ...(destination ? { stream: destination } : {}),
  };
}
