import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

const crypto = await import('node:crypto');
const { generateCapabilityToken, hashCapabilityToken } =
  await import('../src/lib/capability-token.js');

describe('capability tokens (VAL-CLAIM-018, VAL-INVITE-007)', () => {
  it('encodes 32 bytes from the CSPRNG as base64url', () => {
    const randomBytes = vi.mocked(crypto.randomBytes);
    randomBytes.mockClear();
    const token = generateCapabilityToken();

    expect(randomBytes).toHaveBeenCalledTimes(1);
    expect(randomBytes).toHaveBeenCalledWith(32);
    const bytes = randomBytes.mock.results[0]?.value as Buffer;
    expect(token).toBe(bytes.toString('base64url'));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes with SHA-256 so stored values never equal the token', () => {
    const token = generateCapabilityToken();
    const hash = hashCapabilityToken(token);
    expect(hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token);
    expect(hashCapabilityToken(token)).toBe(hash);
  });
});
