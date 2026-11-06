import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { GameDetailScreen } from '@/features/games/game-detail-screen';
import { gameKeys } from '@/features/games/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function GameDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const viewer = useSession().user?.username;
  // Access to a group's game can be lost while this screen waits further back in the stack.
  useInvalidateOnFocus([gameKeys.detail(id ?? '')]);
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Game',
        }}
      />
      <GameDetailScreen key={id} id={id} viewer={viewer} />
    </>
  );
}
