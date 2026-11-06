import { router, Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { ChallengeComposer } from '@/features/challenges/composer-screen';
import { Colors } from '@/theme';

export default function NewChallengeRoute() {
  const { opponent, tournament } = useLocalSearchParams<{
    opponent?: string;
    tournament?: string;
  }>();
  const viewer = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'New challenge',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      {viewer && (
        <ChallengeComposer
          viewer={viewer}
          initialOpponent={opponent || undefined}
          initialTournament={tournament || undefined}
          onCreated={(challenge) =>
            router.replace({ pathname: '/challenges/[id]', params: { id: challenge.id } })
          }
        />
      )}
    </>
  );
}
