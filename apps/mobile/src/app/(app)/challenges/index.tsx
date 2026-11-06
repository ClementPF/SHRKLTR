import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { ChallengesScreen } from '@/features/challenges/challenges-screen';
import { challengeKeys } from '@/features/challenges/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';
import { Colors } from '@/theme';

export default function ChallengesRoute() {
  const viewerId = useSession().user?.id;
  useInvalidateOnFocus([challengeKeys.lists()]);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Challenges',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <ChallengesScreen viewerId={viewerId} />
    </>
  );
}
