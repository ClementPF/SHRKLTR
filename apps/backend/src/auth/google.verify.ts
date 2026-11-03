import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { ApiError } from '../lib/errors.js';

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: true;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  picture: string | null;
  locale: string | null;
}

export type GoogleTokenVerifier = (idToken: string) => Promise<GoogleIdentity>;

export interface GoogleVerifierOptions {
  jwksUrl: string;
  clientId: string;
}

function optionalString(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Builds a verifier bound to one JWKS endpoint; keys are fetched lazily and cached by jose. */
export function createGoogleVerifier(opts: GoogleVerifierOptions): GoogleTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl));

  return async (idToken) => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: opts.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (err) {
      if (err instanceof joseErrors.JOSEError) {
        throw ApiError.unauthorized('Invalid Google ID token', 'INVALID_ID_TOKEN');
      }
      throw err;
    }

    // Google sends email_verified as a boolean, but some older tokens carried the string "true".
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    if (!verified) {
      throw ApiError.unauthorized('Google account email is not verified', 'EMAIL_NOT_VERIFIED');
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw ApiError.unauthorized('Invalid Google ID token', 'INVALID_ID_TOKEN');
    }

    return {
      sub: payload.sub,
      email: optionalString(payload, 'email'),
      emailVerified: true,
      name: optionalString(payload, 'name'),
      givenName: optionalString(payload, 'given_name'),
      familyName: optionalString(payload, 'family_name'),
      picture: optionalString(payload, 'picture'),
      locale: optionalString(payload, 'locale'),
    };
  };
}
