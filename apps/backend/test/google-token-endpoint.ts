import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TokenRequest {
  method: string;
  contentType: string | undefined;
  params: Record<string, string>;
}

export interface TokenReply {
  status: number;
  body: unknown;
}

export type TokenHandler = (params: Record<string, string>) => TokenReply | Promise<TokenReply>;

export interface TestGoogleTokenEndpoint {
  url: string;
  received: TokenRequest[];
  /** Replaces how the endpoint answers; reset() restores the default handler. */
  handle(handler: TokenHandler): void;
  reset(): void;
  close(): Promise<void>;
}

/**
 * Loopback stand-in for Google's OAuth token endpoint (OS-assigned port). It parses the
 * form-encoded exchange request and answers through a swappable handler.
 */
export async function startTestGoogleTokenEndpoint(
  defaultHandler: TokenHandler,
): Promise<TestGoogleTokenEndpoint> {
  const received: TokenRequest[] = [];
  let handler = defaultHandler;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const params = Object.fromEntries(
        new URLSearchParams(Buffer.concat(chunks).toString('utf8')),
      );
      received.push({
        method: req.method ?? '',
        contentType: req.headers['content-type'],
        params,
      });
      Promise.resolve(handler(params)).then(
        ({ status, body }) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        },
        () => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal_failure' }));
        },
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/token`,
    received,
    handle(next) {
      handler = next;
    },
    reset() {
      received.length = 0;
      handler = defaultHandler;
    },
    close() {
      return new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
