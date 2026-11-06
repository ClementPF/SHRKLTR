/** Kept apart from the hooks so group eviction can name the root without an import cycle. */
export type ChallengeFilter = 'active' | 'past';

/** Session-bound: the session store clears the whole cache on sign-out or account switch. */
export const challengeKeys = {
  all: ['challenges'] as const,
  lists: () => ['challenges', 'list'] as const,
  list: (filter: ChallengeFilter) => ['challenges', 'list', filter] as const,
  detail: (id: string) => ['challenges', 'detail', id] as const,
};
