import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';

export const TEST_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const KID = 'test-google-key';

export interface MintOptions {
  claims?: JWTPayload;
  issuer?: string;
  audience?: string;
  /** Seconds from now; negative values produce an already-expired token. */
  expiresIn?: number;
  signingKey?: CryptoKey;
}

export interface TestGoogleJwks {
  url: string;
  mint(opts?: MintOptions): Promise<string>;
  /** A key that is not in the served JWKS, for forged-signature cases. */
  foreignKey: CryptoKey;
  close(): Promise<void>;
}

/** Serves a JWKS on loopback (OS-assigned port) and mints Google-shaped ID tokens against it. */
export async function startTestGoogleJwks(): Promise<TestGoogleJwks> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  const body = JSON.stringify({ keys: [jwk] });

  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/oauth2/v3/certs`,
    foreignKey: foreign.privateKey,
    async mint(opts = {}) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({
        email: 'ada@example.com',
        email_verified: true,
        name: 'Ada Lovelace',
        ...opts.claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
        .setSubject(typeof opts.claims?.sub === 'string' ? opts.claims.sub : 'google-sub-ada')
        .setIssuer(opts.issuer ?? 'https://accounts.google.com')
        .setAudience(opts.audience ?? TEST_GOOGLE_CLIENT_ID)
        .setIssuedAt(now - 60)
        .setExpirationTime(now + (opts.expiresIn ?? 3600))
        .sign(opts.signingKey ?? privateKey);
    },
    close() {
      return new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
