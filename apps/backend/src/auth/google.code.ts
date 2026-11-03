import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';

const TOKEN_TIMEOUT_MS = 10_000;

export interface GoogleCodeExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/** Exchanges an authorization code at Google's token endpoint and returns the ID token. */
export type GoogleCodeExchanger = (
  input: GoogleCodeExchange,
  log: FastifyBaseLogger,
) => Promise<string>;

export interface GoogleCodeExchangerOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string | undefined;
  redirectAllowlist: readonly string[];
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

const upstreamError = () =>
  new ApiError(502, 'GOOGLE_UPSTREAM_ERROR', 'Google token exchange failed');

/** Google's OAuth error codes are short snake_case identifiers; anything else is not logged. */
function googleErrorCode(body: unknown): string | undefined {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && /^[a-z_]{1,64}$/.test(error) ? error : undefined;
}

export function createGoogleCodeExchanger(opts: GoogleCodeExchangerOptions): GoogleCodeExchanger {
  const allowed = new Set(opts.redirectAllowlist);

  return async ({ code, codeVerifier, redirectUri }, log) => {
    if (!allowed.has(redirectUri)) {
      throw ApiError.badRequest('redirectUri is not allowed', 'REDIRECT_URI_NOT_ALLOWED');
    }
    if (!opts.clientSecret) {
      throw new ApiError(
        503,
        'GOOGLE_EXCHANGE_UNAVAILABLE',
        'Google sign-in is not configured on this server',
      );
    }

    let res: Response;
    try {
      res = await fetch(opts.tokenUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch (err) {
      // Only the error name is logged: fetch errors can echo request details in their causes.
      log.warn(
        { reason: err instanceof Error ? err.name : 'unknown' },
        'google token exchange failed',
      );
      throw upstreamError();
    }

    const body: unknown = await res.json().catch(() => null);
    if (res.status >= 400 && res.status < 500) {
      log.warn(
        { status: res.status, googleError: googleErrorCode(body) },
        'google token exchange rejected',
      );
      throw ApiError.unauthorized('Invalid authorization code', 'INVALID_AUTHORIZATION_CODE');
    }
    if (!res.ok) {
      log.warn({ status: res.status }, 'google token exchange failed');
      throw upstreamError();
    }

    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      log.warn({ status: res.status }, 'google token response missing id_token');
      throw upstreamError();
    }
    return parsed.data.id_token;
  };
}
