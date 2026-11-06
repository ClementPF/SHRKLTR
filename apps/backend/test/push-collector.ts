import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedPush {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** One Expo message as the backend sent it (`to` is the only place a device token appears). */
export interface PushMessage {
  to: string;
  title?: string;
  body?: string;
  sound?: string;
  data?: Record<string, unknown>;
}

type TicketFactory = (messages: PushMessage[]) => unknown[];

type Reply =
  | { kind: 'tickets'; tickets: TicketFactory }
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'raw'; status: number; text: string };

export interface PushCollector {
  url: string;
  received: ReceivedPush[];
  /** Every message of every received batch, in arrival order. */
  messages(): PushMessage[];
  /** Answers each batch with these tickets (one per message, in order) under HTTP 200. */
  respondWithTickets(tickets: TicketFactory): void;
  /** Answers with this status and JSON body. */
  respondWith(status: number, body?: unknown): void;
  /** Answers with a non-JSON body. */
  respondRaw(status: number, text: string): void;
  /** Waits this long before answering (bounded-timeout checks). */
  delay(ms: number): void;
  /** Runs before each answer, while the backend is still waiting on the request. */
  onRequest(hook: ((push: ReceivedPush) => Promise<void> | void) | null): void;
  reset(): void;
  close(): Promise<void>;
}

const okTickets: TicketFactory = (messages) =>
  messages.map((_, i) => ({ status: 'ok', id: `test-ticket-${i}` }));

/** Loopback HTTP listener (OS-assigned port) standing in for the Expo push API. */
export async function startPushCollector(): Promise<PushCollector> {
  const received: ReceivedPush[] = [];
  let reply: Reply = { kind: 'tickets', tickets: okTickets };
  let delayMs = 0;
  let hook: ((push: ReceivedPush) => Promise<void> | void) | null = null;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          // keep raw text
        }
        const push = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
        received.push(push);
        const current = reply;
        if (hook) await hook(push);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (res.destroyed) return;
        if (current.kind === 'raw') {
          res.writeHead(current.status, { 'content-type': 'text/plain' });
          res.end(current.text);
          return;
        }
        const messages = Array.isArray(body) ? (body as PushMessage[]) : [];
        const status = current.kind === 'json' ? current.status : 200;
        const payload =
          current.kind === 'json' ? current.body : { data: current.tickets(messages) };
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/--/api/v2/push/send`,
    received,
    messages() {
      return received.flatMap((r) => (Array.isArray(r.body) ? (r.body as PushMessage[]) : []));
    },
    respondWithTickets(tickets) {
      reply = { kind: 'tickets', tickets };
    },
    respondWith(status, body = { errors: [{ code: 'TEST', message: 'collector failure' }] }) {
      reply = { kind: 'json', status, body };
    },
    respondRaw(status, text) {
      reply = { kind: 'raw', status, text };
    },
    delay(ms) {
      delayMs = ms;
    },
    onRequest(next) {
      hook = next;
    },
    reset() {
      received.length = 0;
      reply = { kind: 'tickets', tickets: okTickets };
      delayMs = 0;
      hook = null;
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
