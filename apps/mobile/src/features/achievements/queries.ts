import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { getRecentAchievements, getUserAchievements } from '@/api/endpoints';

export const RECENT_UNLOCKS_PAGE_SIZE = 5;

export const achievementKeys = {
  all: ['achievements'] as const,
  user: (username: string) => ['achievements', 'user', username] as const,
  recent: (username: string) => ['achievements', 'recent', username] as const,
};

/** The whole badge catalog with this user's locked/unlocked state. */
export function useUserAchievements(username: string | undefined) {
  return useQuery({
    queryKey: achievementKeys.user(username ?? ''),
    queryFn: () => getUserAchievements(username!),
    enabled: !!username,
  });
}

/** The signed-in user's latest unlocks for the personal feed (the API only returns your own). */
export function useRecentUnlocks(username: string | undefined) {
  return useQuery({
    // Keyed by username so an account switch never shows the previous user's unlocks.
    queryKey: achievementKeys.recent(username ?? ''),
    queryFn: () => getRecentAchievements({ pageSize: RECENT_UNLOCKS_PAGE_SIZE }),
    enabled: !!username,
  });
}

export function openAchievements(username: string) {
  router.push({ pathname: '/achievements/[username]', params: { username } });
}
