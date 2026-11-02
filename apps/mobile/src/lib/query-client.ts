import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

/** App-wide client, shared with the API layer so a lost session can wipe cached data. */
export const queryClient = createQueryClient();
