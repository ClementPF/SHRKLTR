import { inArray, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { notifications, users } from '../db/schema.js';
import {
  getPreferencesFor,
  loadNotificationViews,
  type NotificationTarget,
} from './notification.service.js';
import {
  disablePushDeviceToken,
  listActivePushDevices,
  type PushDeviceRow,
} from './push-device.service.js';

export interface PushTransportConfig {
  /** Expo push send endpoint; a loopback collector in tests. */
  url: string;
  accessToken?: string | undefined;
  timeoutMs: number;
}

const pushTicketSchema = z.union([
  z.looseObject({ status: z.literal('ok'), id: z.string() }),
  z.looseObject({
    status: z.literal('error'),
    message: z.string().optional(),
    details: z.looseObject({ error: z.string().optional() }).optional(),
  }),
]);

export type PushTicket = z.infer<typeof pushTicketSchema>;

const pushResponseSchema = z.object({ data: z.array(pushTicketSchema) });

export class PushTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushTransportError';
  }
}

/**
 * Posts one chunk (at most 100 messages) to the Expo send endpoint and returns its tickets in
 * message order. Any transport failure, non-200 reply or ticket list that does not match the
 * chunk throws PushTransportError; bodies are never included because they may echo tokens.
 */
export async function sendPushChunk(
  config: PushTransportConfig,
  messages: readonly ExpoPushMessage[],
): Promise<PushTicket[]> {
  let res: Response;
  let payload: unknown;
  try {
    res = await fetch(config.url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (res.status !== 200) {
      throw new PushTransportError(`Expo push responded with HTTP ${res.status}`);
    }
    payload = await res.json();
  } catch (err) {
    if (err instanceof PushTransportError) throw err;
    const reason = err instanceof Error ? err.name : 'unknown error';
    throw new PushTransportError(`Expo push request failed (${reason})`);
  }
  const parsed = pushResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.data.length !== messages.length) {
    throw new PushTransportError('Expo push returned malformed tickets');
  }
  return parsed.data.data;
}

export interface PushContent {
  title: string;
  body: string;
  /** Always {notificationId, target} for inbox notifications. */
  data: { notificationId?: string; target: NotificationTarget };
}

export interface PushNotifier {
  /** Starts best-effort delivery of committed notifications; never throws, never blocks. */
  dispatch(notificationIds: readonly string[]): void;
  /** Starts best-effort delivery of content without an inbox row to a user's devices. */
  dispatchDirect(userId: string, content: PushContent): void;
  /** Resolves once every delivery started so far (and any started meanwhile) has settled. */
  drain(): Promise<void>;
}

export interface PushNotifierDeps {
  db: Database;
  transport: PushTransportConfig;
  log: FastifyBaseLogger;
  clock: () => Date;
}

interface Outgoing {
  device: PushDeviceRow;
  message: ExpoPushMessage;
}

export function createPushNotifier(deps: PushNotifierDeps): PushNotifier {
  const { db, log } = deps;
  const expo = new Expo();
  const pending = new Set<Promise<void>>();

  function toMessages(devices: readonly PushDeviceRow[], content: PushContent): Outgoing[] {
    return devices
      .filter((device) => Expo.isExpoPushToken(device.expoToken))
      .map((device) => ({
        device,
        message: {
          to: device.expoToken,
          title: content.title,
          body: content.body,
          sound: 'default',
          data: content.data,
        },
      }));
  }

  async function send(outgoing: readonly Outgoing[]): Promise<void> {
    let offset = 0;
    for (const chunk of expo.chunkPushNotifications(outgoing.map((o) => o.message))) {
      const batch = outgoing.slice(offset, offset + chunk.length);
      offset += chunk.length;
      let tickets: PushTicket[];
      try {
        tickets = await sendPushChunk(deps.transport, chunk);
      } catch (err) {
        log.warn({ reason: err instanceof Error ? err.message : 'unknown' }, 'push chunk failed');
        continue;
      }
      for (const [i, ticket] of tickets.entries()) {
        const sent = batch[i];
        if (!sent || ticket.status !== 'error') continue;
        const error = ticket.details?.error;
        if (error === 'DeviceNotRegistered') {
          await disablePushDeviceToken(db, sent.device.id, sent.device.expoToken, deps.clock());
          log.info({ deviceId: sent.device.id }, 'push device disabled: DeviceNotRegistered');
        } else {
          log.warn(
            { deviceId: sent.device.id, pushError: error ?? 'unknown' },
            'push ticket error',
          );
        }
      }
    }
  }

  async function deliver(notificationIds: readonly string[]): Promise<void> {
    if (notificationIds.length === 0) return;
    const rows = await db
      .select({
        id: notifications.id,
        recipientId: notifications.recipientUserId,
        category: notifications.category,
        accountType: users.accountType,
      })
      .from(notifications)
      .innerJoin(users, eq(notifications.recipientUserId, users.id))
      .where(inArray(notifications.id, [...notificationIds]));
    const preferences = await getPreferencesFor(db, [...new Set(rows.map((r) => r.recipientId))]);

    const idsByRecipient = new Map<string, string[]>();
    for (const row of rows) {
      if (row.accountType !== 'REGISTERED') continue;
      if (preferences.get(row.recipientId)?.[row.category] === false) continue;
      idsByRecipient.set(row.recipientId, [...(idsByRecipient.get(row.recipientId) ?? []), row.id]);
    }

    const outgoing: Outgoing[] = [];
    for (const [recipientId, ids] of idsByRecipient) {
      const devices = await listActivePushDevices(db, recipientId);
      if (devices.length === 0) continue;
      // Rendering through the inbox query rechecks that the recipient may still see the source.
      const views = await loadNotificationViews(db, recipientId, inArray(notifications.id, ids));
      for (const view of views) {
        if (!view.target) continue;
        outgoing.push(
          ...toMessages(devices, {
            title: view.title,
            body: view.body,
            data: { notificationId: view.notification.id, target: view.target },
          }),
        );
      }
    }
    await send(outgoing);
  }

  async function deliverDirect(userId: string, content: PushContent): Promise<void> {
    await send(toMessages(await listActivePushDevices(db, userId), content));
  }

  function track(work: () => Promise<void>): void {
    const run = work()
      .catch((err: unknown) => {
        log.error(
          { reason: err instanceof Error ? err.message : 'unknown' },
          'push delivery failed',
        );
      })
      .finally(() => pending.delete(run));
    pending.add(run);
  }

  return {
    dispatch(notificationIds) {
      if (notificationIds.length > 0) track(() => deliver(notificationIds));
    },
    dispatchDirect(userId, content) {
      track(() => deliverDirect(userId, content));
    },
    async drain() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
