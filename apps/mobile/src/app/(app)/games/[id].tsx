import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { GameDetailScreen } from '@/features/games/game-detail-screen';
import { Colors } from '@/theme';

export default function GameDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const viewer = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Game',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <GameDetailScreen key={id} id={id} viewer={viewer} />
    </>
  );
}
