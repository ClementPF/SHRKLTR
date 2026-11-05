import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { router } from 'expo-router';

import {
  addGroupPlayer,
  createGroup,
  createGroupInvite,
  getGroup,
  getGroupInvitePreview,
  joinGroup,
  leaveGroup,
  listGroupInvites,
  listGroupMembers,
  listGroupPlayers,
  listGroups,
  listGroupTournaments,
  removeGroupMember,
  revokeGroupInvite,
  setGroupMemberRole,
  transferGroupOwnership,
} from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type {
  CreateGroupInviteRequest,
  Game,
  Group,
  GroupMember,
  GroupRole,
  JoinGroupRequest,
  Tournament,
} from '@/api/types';
import { achievementKeys } from '@/features/achievements/queries';
import { gameKeys } from '@/features/games/queries';
import { notificationKeys } from '@/features/notifications/queries';
import { tournamentKeys } from '@/features/tournaments/queries';
import { statsKeys, userKeys } from '@/features/users/queries';
import { nextPageParam } from '@/lib/pagination';

/** Everything about one group sits under `group(id)`, so it can be evicted in one go. */
export const groupKeys = {
  all: ['groups'] as const,
  list: () => ['groups', 'list'] as const,
  group: (id: string) => ['groups', 'detail', id] as const,
  detail: (id: string) => ['groups', 'detail', id, 'summary'] as const,
  members: (id: string) => ['groups', 'detail', id, 'members'] as const,
  tournaments: (id: string) => ['groups', 'detail', id, 'tournaments'] as const,
  players: (id: string) => ['groups', 'detail', id, 'players'] as const,
  invites: (id: string) => ['groups', 'detail', id, 'invites'] as const,
  invitePreview: (token: string) => ['invites', 'group', token] as const,
};

/** The API maximum, so most groups list all their members in one page. */
export const MEMBERS_PAGE_SIZE = 100;

export const GROUP_NAME_MAX = 100;

export const canManage = (role: GroupRole | undefined) => role === 'OWNER' || role === 'ADMIN';

/** An unknown group, one you are not (or no longer) a member of, or a malformed id. */
export function isGroupMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

const retryUnlessMissing = (failureCount: number, error: Error) =>
  !isGroupMissing(error) && failureCount < 1;

export function openGroup(id: string) {
  router.push({ pathname: '/groups/[id]', params: { id } });
}

export function useGroups(enabled = true) {
  return useQuery({ queryKey: groupKeys.list(), queryFn: listGroups, enabled });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: groupKeys.detail(id),
    queryFn: () => getGroup(id),
    retry: retryUnlessMissing,
  });
}

export function useGroupMembers(id: string, enabled = true) {
  return useInfiniteQuery<
    GroupMember[],
    Error,
    InfiniteData<GroupMember[], number>,
    QueryKey,
    number
  >({
    queryKey: groupKeys.members(id),
    queryFn: ({ pageParam }) =>
      listGroupMembers(id, { page: pageParam, pageSize: MEMBERS_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam(MEMBERS_PAGE_SIZE),
    retry: retryUnlessMissing,
    enabled,
  });
}

export function useGroupTournaments(id: string, enabled = true) {
  return useQuery({
    queryKey: groupKeys.tournaments(id),
    queryFn: () => listGroupTournaments(id),
    retry: retryUnlessMissing,
    enabled,
  });
}

export function useGroupPlayers(id: string, enabled = true) {
  return useQuery({
    queryKey: groupKeys.players(id),
    queryFn: () => listGroupPlayers(id),
    retry: retryUnlessMissing,
    enabled,
  });
}

export function useGroupInvites(id: string, enabled: boolean) {
  return useQuery({
    queryKey: groupKeys.invites(id),
    queryFn: () => listGroupInvites(id),
    retry: retryUnlessMissing,
    enabled,
  });
}

export function useGroupInvitePreview(token: string) {
  return useQuery({
    queryKey: groupKeys.invitePreview(token),
    queryFn: () => getGroupInvitePreview(token),
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 1,
    staleTime: 0,
  });
}

// Roots whose cached rows can come from a members-only tournament.
const privateDataRoots = (): readonly QueryKey[] => [
  groupKeys.list(),
  tournamentKeys.all,
  userKeys.all,
  statsKeys.all,
  gameKeys.all,
  notificationKeys.all,
  achievementKeys.all,
];

/**
 * Unused caches are removed so they can't flash stale private rows later. Mounted ones are
 * refetched instead: their observers are not told about a removal, so their screens would keep
 * the stale result. Queries the server already refused are not refetched either: their screens
 * show not-found, and a refetch would reset them and re-run the eviction their 404 triggered.
 */
function evictQueries(
  queryClient: QueryClient,
  queryKey: QueryKey,
  keep: (query: Query) => boolean = () => false,
) {
  queryClient.removeQueries({ queryKey, type: 'inactive', predicate: (query) => !keep(query) });
  void queryClient.invalidateQueries({
    queryKey,
    predicate: (query) => !keep(query) && !isGroupMissing(query.state.error),
  });
}

function evictPrivateData(queryClient: QueryClient, tournamentNames: Iterable<string>) {
  for (const name of tournamentNames) evictQueries(queryClient, [...tournamentKeys.all, name]);
  for (const queryKey of privateDataRoots()) evictQueries(queryClient, queryKey);
}

/**
 * Drops what this account may no longer see after losing access to a group: the group's own
 * queries (except its summary, whose 404 drives the not-found screen), its tournaments, and any
 * cached list that could hold its games or standings.
 */
export function evictGroupData(
  queryClient: QueryClient,
  groupId: string,
  alsoTournaments: readonly string[] = [],
) {
  const tournaments = queryClient.getQueryData<Tournament[]>(groupKeys.tournaments(groupId)) ?? [];
  const group = groupKeys.group(groupId);
  evictQueries(queryClient, group, (query) => query.queryKey[group.length] === 'summary');
  evictPrivateData(queryClient, new Set([...tournaments.map((t) => t.name), ...alsoTournaments]));
}

/** The group of a tournament, from any cached copy of it. */
function cachedGroupOf(queryClient: QueryClient, tournamentName: string): string | undefined {
  const lists = [
    queryClient.getQueryData<Tournament[]>(tournamentKeys.list()),
    ...queryClient
      .getQueriesData<Tournament[]>({
        queryKey: groupKeys.all,
        predicate: (query) => query.queryKey[3] === 'tournaments',
      })
      .map(([, data]) => data),
  ];
  const games = queryClient
    .getQueriesData<Game>({ queryKey: [...gameKeys.all, 'detail'] })
    .map(([, game]) => game?.tournament);
  return [...lists.flatMap((list) => list ?? []), ...games].find((t) => t?.name === tournamentName)
    ?.group?.id;
}

/**
 * After a tournament-scoped read was refused (404): the tournament may belong to a group the
 * account just left or was removed from, so drop that group's data when it is known, and in
 * any case every cache that could hold the tournament's games or standings.
 */
export function evictTournamentData(
  queryClient: QueryClient,
  tournamentName: string | undefined,
  groupId?: string | null,
) {
  const owner =
    groupId ?? (tournamentName ? cachedGroupOf(queryClient, tournamentName) : undefined);
  const names = tournamentName ? [tournamentName] : [];
  if (owner) evictGroupData(queryClient, owner, names);
  else evictPrivateData(queryClient, names);
}

function invalidateAfterJoin(queryClient: QueryClient) {
  for (const queryKey of [
    groupKeys.all,
    tournamentKeys.all,
    userKeys.all,
    statsKeys.all,
    achievementKeys.all,
    notificationKeys.all,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createGroup(name),
    onSuccess: (group) => {
      queryClient.setQueryData(groupKeys.detail(group.id), group);
      // Creating your first group unlocks a badge.
      for (const queryKey of [groupKeys.list(), achievementKeys.all, notificationKeys.all]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useJoinGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: JoinGroupRequest) => joinGroup(body),
    onSuccess: ({ group }) => {
      queryClient.setQueryData(groupKeys.detail(group.id), group);
      invalidateAfterJoin(queryClient);
    },
  });
}

function useGroupMutation<TVariables, TData>(
  groupId: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: groupKeys.group(groupId) }),
  });
}

export function useSetMemberRole(groupId: string) {
  return useGroupMutation(
    groupId,
    ({ userId, role }: { userId: string; role: 'ADMIN' | 'MEMBER' }) =>
      setGroupMemberRole(groupId, userId, role),
  );
}

export function useRemoveMember(groupId: string) {
  return useGroupMutation(groupId, (userId: string) => removeGroupMember(groupId, userId));
}

export function useTransferOwnership(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => transferGroupOwnership(groupId, userId),
    onSuccess: (group: Group) => queryClient.setQueryData(groupKeys.detail(groupId), group),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.group(groupId) }),
        queryClient.invalidateQueries({ queryKey: groupKeys.list() }),
      ]),
  });
}

export function useLeaveGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveGroup(groupId),
    onSuccess: () => {
      evictGroupData(queryClient, groupId);
      queryClient.removeQueries({ queryKey: groupKeys.group(groupId) });
    },
  });
}

export function useAddGroupPlayer(groupId: string) {
  return useGroupMutation(groupId, (placeholderUserId: string) =>
    addGroupPlayer(groupId, placeholderUserId),
  );
}

export function useCreateGroupInvite(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGroupInviteRequest) => createGroupInvite(groupId, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: groupKeys.invites(groupId) }),
  });
}

export function useRevokeGroupInvite(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => revokeGroupInvite(groupId, inviteId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: groupKeys.invites(groupId) }),
  });
}
