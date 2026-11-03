import type { FastifyBaseLogger } from 'fastify';

const PUSH_TIMEOUT_MS = 5000;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Extra app-specific fields, delivered alongside title/message in the notification data. */
  payload?: Record<string, unknown>;
}

export interface ExpoPushRequest {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: { title: string; message: string; payload?: Record<string, unknown> };
}

export function buildExpoPushRequest(message: PushMessage): ExpoPushRequest {
  return {
    to: message.to,
    title: message.title,
    body: message.body,
    sound: 'default',
    data: {
      title: message.title,
      message: message.body,
      ...(message.payload ? { payload: message.payload } : {}),
    },
  };
}

/**
 * Posts one notification to the Expo push API. Delivery is best effort: transport errors,
 * non-2xx replies and Expo per-ticket errors are logged and reported as `false`, never thrown.
 */
export async function sendPush(
  pushUrl: string,
  message: PushMessage,
  log: FastifyBaseLogger,
): Promise<boolean> {
  try {
    const res = await fetch(pushUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(buildExpoPushRequest(message)),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'push delivery rejected');
      return false;
    }
    // Expo answers 200 even when the ticket itself failed (e.g. DeviceNotRegistered).
    const ticket: unknown = await res.json().catch(() => null);
    const data = (ticket as { data?: { status?: unknown; message?: unknown } } | null)?.data;
    if (data?.status === 'error') {
      log.warn({ pushError: data.message }, 'push ticket error');
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err }, 'push delivery failed');
    return false;
  }
}
