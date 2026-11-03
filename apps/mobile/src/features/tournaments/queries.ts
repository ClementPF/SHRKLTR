import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import {
  createTournament,
  getTournament,
  getTournamentGames,
  getTournamentStats,
  listSports,
  listTournaments,
} from '@/api/endpoints';
import type { CreateTournamentRequest, Game } from '@/api/types';
import { DETAIL_PAGE_SIZE } from '@/features/users/queries';
import { nextPageParam } from '@/lib/pagination';

/** Every key starts with 'tournaments' so one invalidation refreshes lists and details. */
export const tournamentKeys = {
  all: ['tournaments'] as const,
  list: () => ['tournaments', 'list'] as const,
  detail: (name: string) => ['tournaments', name, 'detail'] as const,
  stats: (name: string) => ['tournaments', name, 'stats'] as const,
  games: (name: string, pageSize: number) => ['tournaments', name, 'games', { pageSize }] as const,
};

export const sportKeys = { all: ['sports'] as const };

export function useTournaments() {
  return useQuery({ queryKey: tournamentKeys.list(), queryFn: () => listTournaments() });
}

export function useTournament(name: string) {
  return useQuery({ queryKey: tournamentKeys.detail(name), queryFn: () => getTournament(name) });
}

export function useTournamentLeaderboard(name: string) {
  return useQuery({
    queryKey: tournamentKeys.stats(name),
    queryFn: () => getTournamentStats(name),
  });
}

export function useTournamentGames(name: string, pageSize: number = DETAIL_PAGE_SIZE) {
  return useInfiniteQuery<Game[], Error, InfiniteData<Game[], number>, readonly unknown[], number>({
    queryKey: tournamentKeys.games(name, pageSize),
    queryFn: ({ pageParam }) => getTournamentGames(name, { page: pageParam, pageSize }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam(pageSize),
  });
}

export function useSports() {
  return useQuery({ queryKey: sportKeys.all, queryFn: listSports });
}

export function useCreateTournament() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTournamentRequest) => createTournament(body),
    onSuccess: async () => {
      // The sport may have been created implicitly, so both lists can change.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tournamentKeys.all }),
        queryClient.invalidateQueries({ queryKey: sportKeys.all }),
      ]);
    },
  });
}
