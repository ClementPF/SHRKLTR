import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { ProfileScreen } from '@/features/feed/profile-screen';
import { Colors } from '@/theme';

export default function UserDetailScreen() {
  const { username, tournamentName } = useLocalSearchParams<{
    username: string;
    tournamentName?: string;
  }>();
  const viewer = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: username,
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
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
