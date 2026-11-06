import { useCallback, useEffect, useState } from 'react';

import { clearPendingJoin, readPendingJoin, type PendingJoin } from '@/auth/pending-join';

const ignore = () => undefined;

export interface PendingJoinState {
  pending: PendingJoin | null;
  hydrated: boolean;
  /** Abandons the invitation so nothing prompts for it again. */
  discard(): void;
}

/** The group invitation left pending by a signed-out visit, if any. */
export function usePendingJoin(enabled = true): PendingJoinState {
  const [pending, setPending] = useState<PendingJoin | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void readPendingJoin()
      .catch(() => null)
      .then((join) => {
        if (!active) return;
        setPending(join);
        setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  const discard = useCallback(() => {
    setPending(null);
    void clearPendingJoin().catch(ignore);
  }, []);

  return { pending: enabled ? pending : null, hydrated: !enabled || hydrated, discard };
}
