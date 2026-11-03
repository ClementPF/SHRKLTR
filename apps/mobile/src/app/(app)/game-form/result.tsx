import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { GameResultScreen } from '@/features/game-form/result-screen';
import { Colors } from '@/theme';

export default function GameResultRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const viewer = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Results',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <GameResultScreen id={id} viewer={viewer} />
    </>
  );
}
