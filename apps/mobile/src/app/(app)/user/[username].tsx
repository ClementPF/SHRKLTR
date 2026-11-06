import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { achievementKeys } from '@/features/achievements/queries';
import { ProfileScreen } from '@/features/feed/profile-screen';
import { statsKeys, userKeys } from '@/features/users/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function UserDetailScreen() {
  const { username, tournamentName } = useLocalSearchParams<{
    username: string;
    tournamentName?: string;
  }>();
  const viewer = useSession().user?.username;
  // Access to the player's private tournaments can be lost while this screen is further back.
  useInvalidateOnFocus([
    [...userKeys.all, username],
    [...statsKeys.all, username],
    achievementKeys.user(username),
  ]);
  return (
    <>
      <Stack.Screen
        options={{
          title: username,
        }}
      />
      <ProfileScreen
        key={`${username}/${tournamentName ?? ''}`}
        username={username}
        tournamentName={tournamentName || undefined}
        viewer={viewer}
      />
    </>
  );
}
