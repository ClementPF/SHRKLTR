import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Marks the given query roots stale whenever the screen regains focus (not on first mount), so
 * returning to a tab shows data changed elsewhere, e.g. a game submitted from another device.
 */
export function useInvalidateOnFocus(queryKeys: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  const focusedOnce = useRef(false);
  // Callers pass inline arrays; a serialized dependency keeps the focus callback stable.
  const serializedKeys = JSON.stringify(queryKeys);

  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      for (const queryKey of JSON.parse(serializedKeys) as QueryKey[]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }, [queryClient, serializedKeys]),
  );
}
