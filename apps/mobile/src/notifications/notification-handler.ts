import type { QueryClient } from '@tanstack/react-query';

/**
 * Pushes (challenges, postgame results) mean server data changed: mark every cached query stale
 * so visible screens refetch.
 */
export function createNotificationReceivedHandler(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
): () => void {
  return () => {
    void queryClient.invalidateQueries();
  };
}
