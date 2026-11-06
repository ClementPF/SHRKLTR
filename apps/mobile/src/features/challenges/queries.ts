import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { router } from 'expo-router';

import {
  createChallenge,
  getChallenge,
  listChallenges,
  listGroupMembers,
  respondToChallenge,
} from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type {
  Challenge,
  ChallengeResponse,
  ChallengeStatus,
  CreateChallengeRequest,
  Tournament,
} from '@/api/types';
import { groupKeys, isGroupMissing, MEMBERS_PAGE_SIZE } from '@/features/groups/queries';
import { notificationKeys } from '@/features/notifications/queries';
import { useTournaments } from '@/features/tournaments/queries';
import { nextPageParam } from '@/lib/pagination';

import { challengeKeys, type ChallengeFilter } from './keys';

export { challengeKeys, type ChallengeFilter } from './keys';

export const CHALLENGES_PAGE_SIZE = 20;

export const FILTER_STATUSES: Record<ChallengeFilter, readonly ChallengeStatus[]> = {
  active: ['PENDING', 'ACCEPTED'],
  past: ['DECLINED', 'COMPLETED', 'EXPIRED'],
};

/** An unknown challenge, someone else's, one of a tournament you can't see, or a malformed id. */
export function isChallengeMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

const retryUnlessMissing = (failureCount: number, error: Error) =>
  !isChallengeMissing(error) && failureCount < 1;

export function openChallenge(id: string) {
  router.push({ pathname: '/challenges/[id]', params: { id } });
}

export function openChallenges() {
  router.push('/challenges');
}

/** The composer, with the opponent (and tournament) already chosen when known. */
export function openChallengeComposer(prefill: { opponent?: string; tournament?: string } = {}) {
  const params: { opponent?: string; tournament?: string } = {};
  if (prefill.opponent) params.opponent = prefill.opponent;
  if (prefill.tournament) params.tournament = prefill.tournament;
  router.push({ pathname: '/challenges/new', params });
}

type ChallengePages = InfiniteData<Challenge[], number>;

export function useChallenges(
  filter: ChallengeFilter,
): UseInfiniteQueryResult<ChallengePages, Error> {
  return useInfiniteQuery({
    queryKey: challengeKeys.list(filter),
    queryFn: ({ pageParam, signal }) =>
      listChallenges(
        { page: pageParam, pageSize: CHALLENGES_PAGE_SIZE, status: FILTER_STATUSES[filter] },
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: nextPageParam(CHALLENGES_PAGE_SIZE),
  });
}

export function useChallenge(id: string) {
  return useQuery({
    queryKey: challengeKeys.detail(id),
    queryFn: ({ signal }) => getChallenge(id, signal),
    retry: retryUnlessMissing,
    // The other player can answer at any moment, so opening the screen (e.g. from the
    // acceptance notification) refetches even a challenge cached seconds ago.
    staleTime: 0,
  });
}

export function useCreateChallenge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChallengeRequest) => createChallenge(body),
    onSuccess: (challenge) => {
      queryClient.setQueryData(challengeKeys.detail(challenge.id), challenge);
      void queryClient.invalidateQueries({ queryKey: challengeKeys.lists() });
    },
  });
}

export function useRespondToChallenge(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (response: ChallengeResponse) => respondToChallenge(id, response),
    onSuccess: (challenge) => queryClient.setQueryData(challengeKeys.detail(id), challenge),
    onSettled: () => {
      // A refused answer (expired, already answered) means the cached state is outdated.
      for (const queryKey of [
        challengeKeys.detail(id),
        challengeKeys.lists(),
        notificationKeys.all,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

async function fetchMemberUsernames(groupId: string): Promise<string[]> {
  const usernames: string[] = [];
  for (let page = 0; ; page += 1) {
    const members = await listGroupMembers(groupId, { page, pageSize: MEMBERS_PAGE_SIZE });
    usernames.push(...members.map((m) => m.user.username));
    if (members.length < MEMBERS_PAGE_SIZE) return usernames;
  }
}

export interface ChallengeableTournaments {
  data: Tournament[] | undefined;
  isPending: boolean;
  error: Error | null;
  refetch(): void;
}

/**
 * Tournaments both players can see, so a challenge between them can be created there: every
 * open tournament, and a group's tournament only when the opponent is also a member. Finished
 * tournaments are left out, as no game can complete a challenge there.
 */
export function useChallengeableTournaments(
  opponent: string | undefined,
): ChallengeableTournaments {
  const tournaments = useTournaments();
  const running = (tournaments.data ?? []).filter((t) => !t.isOver);
  const groupIds = [...new Set(running.flatMap((t) => (t.group ? [t.group.id] : [])))];
  const members = useQueries({
    queries: groupIds.map((groupId) => ({
      // Under the group's key so losing access to the group evicts it with the rest.
      queryKey: [...groupKeys.group(groupId), 'member-usernames'] as const,
      queryFn: () => fetchMemberUsernames(groupId),
      enabled: !!opponent,
      retry: (failureCount: number, error: Error) => !isGroupMissing(error) && failureCount < 1,
    })),
  });

  if (!opponent || tournaments.isPending || tournaments.isError) {
    return {
      data: undefined,
      isPending: !!opponent && tournaments.isPending,
      error: tournaments.error,
      refetch: () => void tournaments.refetch(),
    };
  }
  const membersOf = new Map(groupIds.map((id, i) => [id, members[i]]));
  if (groupIds.some((id) => membersOf.get(id)?.isPending)) {
    return { data: undefined, isPending: true, error: null, refetch: () => undefined };
  }
  // A group whose member list was refused simply offers none of its tournaments.
  const data = running.filter(
    (t) => !t.group || !!membersOf.get(t.group.id)?.data?.includes(opponent),
  );
  return { data, isPending: false, error: null, refetch: () => void tournaments.refetch() };
}
