import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { evictGroupData, isGroupMissing, useGroup } from './queries';

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
