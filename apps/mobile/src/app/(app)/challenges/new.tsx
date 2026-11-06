import { router, Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { ChallengeComposer } from '@/features/challenges/composer-screen';

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
          title: 'New challenge',
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
