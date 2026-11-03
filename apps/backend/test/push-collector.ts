import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedPush {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface PushCollector {
  url: string;
  received: ReceivedPush[];
  /** HTTP status the collector answers with (200 by default). */
  respondWith(status: number, body?: unknown): void;
  reset(): void;
  close(): Promise<void>;
}

/** Loopback HTTP listener (OS-assigned port) standing in for the Expo push API. */
export async function startPushCollector(): Promise<PushCollector> {
  const received: ReceivedPush[] = [];
  let status = 200;
  let replyBody: unknown = { data: { status: 'ok', id: 'test-ticket' } };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        // keep raw text
      }
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(replyBody));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/--/api/v2/push/send`,
    received,
    respondWith(nextStatus, nextBody = { errors: [{ message: 'collector failure' }] }) {
      status = nextStatus;
      replyBody = nextBody;
    },
    reset() {
      received.length = 0;
      status = 200;
      replyBody = { data: { status: 'ok', id: 'test-ticket' } };
    },
    close() {
      return new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
