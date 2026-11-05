import type { Href } from 'expo-router';

import type { NotificationTarget } from '@/api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isUsername = (value: unknown): value is string =>
  typeof value === 'string' && USERNAME.test(value);

/**
 * Validates a target from an untrusted source (a push payload). Only the typed shapes the API
 * emits are accepted; URLs, paths and unknown types yield null.
 */
export function parseNotificationTarget(value: unknown): NotificationTarget | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'game':
      return isUuid(value.gameId) ? { type: 'game', gameId: value.gameId } : null;
    case 'challenge':
      return isUuid(value.challengeId)
        ? { type: 'challenge', challengeId: value.challengeId }
        : null;
    case 'group':
      return isUuid(value.groupId) ? { type: 'group', groupId: value.groupId } : null;
    case 'achievements':
      return isUsername(value.username) ? { type: 'achievements', username: value.username } : null;
    case 'user':
      return isUsername(value.username) ? { type: 'user', username: value.username } : null;
    default:
      return null;
  }
}

/** The screen a target opens. */
export function notificationTargetHref(target: NotificationTarget): Href {
  switch (target.type) {
    case 'game':
      return { pathname: '/games/[id]', params: { id: target.gameId } };
    case 'achievements':
      return { pathname: '/achievements/[username]', params: { username: target.username } };
    case 'user':
      return { pathname: '/user/[username]', params: { username: target.username } };
    case 'group':
      return { pathname: '/groups/[id]', params: { id: target.groupId } };
    case 'challenge':
      return { pathname: '/challenges/[id]', params: { id: target.challengeId } };
  }
}

/** The validated target inside a push payload's data, or null. */
export function targetFromData(data: unknown): NotificationTarget | null {
  return isRecord(data) ? parseNotificationTarget(data.target) : null;
}

export function notificationIdFrom(data: unknown): string | null {
  return isRecord(data) && isUuid(data.notificationId) ? data.notificationId : null;
}
