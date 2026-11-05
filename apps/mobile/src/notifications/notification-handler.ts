import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { NotificationTarget } from '@/api/types';

import { targetFromData } from './targets';

const NOTIFICATIONS: QueryKey = ['notifications'];

/** Cached data a notification about this target may have made stale. */
export function queryKeysForTarget(target: NotificationTarget | null): QueryKey[] {
  switch (target?.type) {
    case 'game':
      return [
        ['users'],
        ['stats'],
        ['games', 'detail', target.gameId],
        ['tournaments'],
        ['achievements'],
      ];
    case 'achievements':
      return [['achievements']];
    case 'user':
      return [['users'], ['invited-players']];
    case 'challenge':
      return [['challenges']];
    case 'group':
      return [['groups'], ['tournaments']];
    default:
      return [];
  }
}

/**
 * A push received while the app is open only refreshes the inbox and the data it is about;
 * it never navigates (that is reserved for taps).
 */
export function createNotificationReceivedHandler(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
): (notification: { request: { content: { data?: unknown } } }) => void {
  return (notification) => {
    const target = targetFromData(notification.request.content.data);
    for (const queryKey of [NOTIFICATIONS, ...queryKeysForTarget(target)]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}
