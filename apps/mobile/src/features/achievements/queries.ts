import { useQuery } from '@tanstack/react-query';

import { getUserAchievements } from '@/api/endpoints';

export const achievementKeys = {
  all: ['achievements'] as const,
  user: (username: string) => ['achievements', 'user', username] as const,
};

/** The whole badge catalog with this user's locked/unlocked state. */
export function useUserAchievements(username: string | undefined) {
  return useQuery({
    queryKey: achievementKeys.user(username ?? ''),
    queryFn: () => getUserAchievements(username!),
    enabled: !!username,
  });
}
