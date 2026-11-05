import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import {
  getNotificationPreferences,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from '@/api/endpoints';
import type {
  InboxNotification,
  NotificationPreferences,
  UnreadCount,
  UpdateNotificationPreferencesRequest,
} from '@/api/types';
import { nextPageParam } from '@/lib/pagination';

export const INBOX_PAGE_SIZE = 20;

/** Session-bound: the session store clears the whole cache on sign-out or account switch. */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
  unreadCount: () => ['notifications', 'unread-count'] as const,
  preferences: () => ['notification-preferences'] as const,
};

type InboxPages = InfiniteData<InboxNotification[], number>;

export function useInbox(): UseInfiniteQueryResult<InboxPages, Error> {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => listNotifications({ page: pageParam, pageSize: INBOX_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam(INBOX_PAGE_SIZE),
    staleTime: 0,
  });
}

export function useUnreadCount(enabled: boolean = true) {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: getUnreadNotificationCount,
    enabled,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

function updateInboxRows(
  queryClient: QueryClient,
  update: (row: InboxNotification) => InboxNotification,
) {
  queryClient.setQueryData<InboxPages>(notificationKeys.list(), (data) =>
    data ? { ...data, pages: data.pages.map((page) => page.map(update)) } : data,
  );
}

async function settle(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: notificationKeys.all });
}

/** Marks one notification read, updating the inbox and the bell count right away. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const readAt = new Date().toISOString();
      let wasUnread = false;
      updateInboxRows(queryClient, (row) => {
        if (row.id !== id || row.readAt) return row;
        wasUnread = true;
        return { ...row, readAt };
      });
      if (wasUnread) {
        queryClient.setQueryData<UnreadCount>(notificationKeys.unreadCount(), (data) =>
          data ? { count: Math.max(0, data.count - 1) } : data,
        );
      }
    },
    onSettled: () => settle(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const readAt = new Date().toISOString();
      updateInboxRows(queryClient, (row) => (row.readAt ? row : { ...row, readAt }));
      queryClient.setQueryData<UnreadCount>(notificationKeys.unreadCount(), { count: 0 });
    },
    onSettled: () => settle(queryClient),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: getNotificationPreferences,
    staleTime: 0,
  });
}

const UPDATE_PREFERENCES_KEY = ['notification-preferences', 'update'] as const;

/**
 * Saves one or more toggles; the switches move immediately and roll back if saving fails. When the
 * last overlapping save settles, the preferences are refetched from the server.
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: UPDATE_PREFERENCES_KEY,
    mutationFn: (change: UpdateNotificationPreferencesRequest) =>
      updateNotificationPreferences(change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.preferences() });
      const previous = queryClient.getQueryData<NotificationPreferences>(
        notificationKeys.preferences(),
      );
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(notificationKeys.preferences(), {
          ...previous,
          ...change,
        });
      }
      return { previous };
    },
    onError: (_err, change, context) => {
      const previous = context?.previous;
      if (!previous) return;
      // Only the toggles of the failed request roll back; a concurrent change keeps its value.
      const restored = Object.fromEntries(
        Object.keys(change).map((key) => [key, previous[key as keyof NotificationPreferences]]),
      );
      queryClient.setQueryData<NotificationPreferences>(notificationKeys.preferences(), (data) =>
        data ? { ...data, ...restored } : previous,
      );
    },
    onSettled: () => {
      // Responses can arrive out of commit order, so none of their full snapshots is trusted over
      // the optimistic values. Not awaited: a save that starts during the refetch must count as
      // the last one and reconcile again. (onSettled runs while this save still counts.)
      if (queryClient.isMutating({ mutationKey: UPDATE_PREFERENCES_KEY }) <= 1) {
        void queryClient.invalidateQueries({ queryKey: notificationKeys.preferences() });
      }
    },
  });
}
