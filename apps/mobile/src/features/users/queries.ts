import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import {
  challengeUser,
  getRivalry,
  getStats,
  getUserGames,
  getUserRivalries,
  getUserStats,
  getUserTournaments,
} from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, RivalryStats, Stats } from '@/api/types';
import { nextPageParam } from '@/lib/pagination';

export const FEED_PAGE_SIZE = 15;
export const DETAIL_PAGE_SIZE = 10;

/** Every key starts with 'users' or 'stats' so a submitted game can invalidate both roots. */
export const userKeys = {
  all: ['users'] as const,
  stats: (username: string) => ['users', username, 'stats'] as const,
  tournaments: (username: string) => ['users', username, 'tournaments'] as const,
  games: (username: string, tournamentName: string | undefined, pageSize: number) =>
    ['users', username, 'games', { tournamentName: tournamentName ?? null, pageSize }] as const,
  rivalries: (username: string, tournamentName: string | undefined) =>
    ['users', username, 'rivalries', { tournamentName: tournamentName ?? null }] as const,
};

export const statsKeys = {
  all: ['stats'] as const,
  tournament: (username: string, tournamentName: string) =>
    ['stats', username, tournamentName] as const,
  rivalry: (username: string, rivalName: string, tournamentName: string) =>
    ['stats', 'rivalry', username, rivalName, tournamentName] as const,
};

export function useUserStats(username: string | undefined) {
  return useQuery({
    queryKey: userKeys.stats(username ?? ''),
    queryFn: () => getUserStats(username!),
    enabled: !!username,
  });
}

/** Tournaments the user has played in. */
export function useUserTournaments(username: string | undefined) {
  return useQuery({
    queryKey: userKeys.tournaments(username ?? ''),
    queryFn: () => getUserTournaments(username!),
    enabled: !!username,
  });
}

/** Stats of one user in one tournament; null when the user has not played there yet. */
export function useTournamentStats(username: string, tournamentName: string | undefined) {
  return useQuery({
    queryKey: statsKeys.tournament(username, tournamentName ?? ''),
    queryFn: async (): Promise<Stats | null> => {
      try {
        return await getStats(username, tournamentName!);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!tournamentName,
  });
}

export function useUserRivalries(username: string, tournamentName: string | undefined) {
  return useQuery({
    queryKey: userKeys.rivalries(username, tournamentName),
    queryFn: () => getUserRivalries(username, tournamentName),
  });
}

export type GamesQuery = UseInfiniteQueryResult<InfiniteData<Game[], number>, Error>;

export function useUserGames(
  username: string | undefined,
  { tournamentName, pageSize }: { tournamentName?: string; pageSize: number },
): GamesQuery {
  return useInfiniteQuery({
    queryKey: userKeys.games(username ?? '', tournamentName, pageSize),
    queryFn: ({ pageParam, signal }) =>
      getUserGames(username!, { page: pageParam, pageSize, tournamentName }, signal),
    initialPageParam: 0,
    getNextPageParam: nextPageParam(pageSize),
    enabled: !!username,
  });
}

/** Directional rivalry, or null when the two players never met in that tournament. */
export function useRivalry(
  username: string,
  rivalName: string,
  tournamentName: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: statsKeys.rivalry(username, rivalName, tournamentName),
    queryFn: async (): Promise<RivalryStats | null> => {
      try {
        return await getRivalry(username, rivalName, tournamentName);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled,
    // Expanding a row should always show the live rivalry, not a cached snapshot.
    staleTime: 0,
  });
}

export const CHALLENGE_MESSAGE = 'I demand a trial by combat.';

export function challengeFailureMessage(username: string): string {
  return `Challenge failed, ${username} doesn't have push notification turned on.`;
}

export function useChallenge(username: string) {
  return useMutation({
    mutationFn: () => challengeUser(username, CHALLENGE_MESSAGE),
  });
}

export function flattenPages<T>(data: InfiniteData<T[], number> | undefined): T[] {
  return data?.pages.flat() ?? [];
}
