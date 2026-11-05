import { createHash, randomBytes } from 'node:crypto';

export const CAPABILITY_TOKEN_BYTES = 32;

/** A fresh unguessable capability: 32 cryptographically random bytes, base64url encoded. */
export function generateCapabilityToken(): string {
  return randomBytes(CAPABILITY_TOKEN_BYTES).toString('base64url');
}

/** The only form in which claim and invite tokens are persisted. */
export function hashCapabilityToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
