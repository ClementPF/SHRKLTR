import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { evictGroupData, evictTournamentData, isGroupMissing, useGroup } from './queries';

/**
 * The group summary plus whether the group is out of reach (unknown, never joined, or access
 * lost since it was cached). Losing access evicts the group's cached private data.
 */
export function useGroupAccess(id: string, ...related: readonly { error: unknown }[]) {
  const queryClient = useQueryClient();
  const group = useGroup(id);
  const missing = isGroupMissing(group.error) || related.some((q) => isGroupMissing(q.error));

  useEffect(() => {
    if (missing) evictGroupData(queryClient, id);
  }, [missing, queryClient, id]);

  return { group, missing };
}

/**
 * Once a read inside a tournament (its standings, a game, a scoped profile) is refused, the
 * account may have lost access to the tournament's group: evicts what could still show it.
 */
export function useEvictWhenDenied(
  denied: boolean,
  tournamentName: string | undefined,
  groupId?: string | null,
) {
  const queryClient = useQueryClient();
  // The eviction clears the refused query's data, which may be where the tournament came from:
  // evicting again for the now-unknown tournament would only refetch app-wide lists once more.
  const evicted = useRef(false);
  useEffect(() => {
    if (denied && !evicted.current) evictTournamentData(queryClient, tournamentName, groupId);
    evicted.current = denied;
  }, [denied, queryClient, tournamentName, groupId]);
}
