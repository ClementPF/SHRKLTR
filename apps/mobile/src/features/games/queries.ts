import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { getGame, issueGameShare, revokeGameShare } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { GameShare } from '@/api/types';

export const gameKeys = {
  all: ['games'] as const,
  detail: (id: string) => ['games', 'detail', id] as const,
  /** My public link for the game: set by issuing it, null once revoked. Never fetched. */
  share: (id: string) => ['games', 'share', id] as const,
};

/** A malformed id is rejected by validation (400) and an unknown or invisible one is a 404. */
export function isGameMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

/** One saved game, fetched by its durable id so the screen survives reloads and deep links. */
export function useGame(id: string | undefined) {
  return useQuery({
    queryKey: gameKeys.detail(id ?? ''),
    queryFn: ({ signal }) => getGame(id!, signal),
    enabled: !!id,
    retry: (failureCount, error) => !isGameMissing(error) && failureCount < 1,
  });
}

/**
 * The link this account issued for the game during this session, shared by every screen that
 * shows the game. There is no read endpoint: issuing returns the active link if one exists.
 */
export function useMyGameShare(gameId: string) {
  return useQuery<GameShare | null>({ queryKey: gameKeys.share(gameId), queryFn: skipToken });
}

export function useIssueGameShare(gameId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => issueGameShare(gameId),
    onSuccess: (share) => queryClient.setQueryData(gameKeys.share(gameId), share),
  });
}

export function useRevokeGameShare(gameId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => revokeGameShare(gameId, shareId),
    onSuccess: (_, shareId) =>
      // Set to null rather than removed: a removed query would leave mounted screens stale.
      queryClient.setQueryData<GameShare | null>(gameKeys.share(gameId), (current) =>
        current?.shareId === shareId ? null : current,
      ),
  });
}

export function openGame(id: string) {
  router.push({ pathname: '/games/[id]', params: { id } });
}
