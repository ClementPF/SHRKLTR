import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { GameResultScreen } from '@/features/game-form/result-screen';

export default function GameResultRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const viewer = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Results',
        }}
      />
      <GameResultScreen id={id} viewer={viewer} />
    </>
  );
}
