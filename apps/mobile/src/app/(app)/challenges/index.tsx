import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { ChallengesScreen } from '@/features/challenges/challenges-screen';
import { challengeKeys } from '@/features/challenges/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function ChallengesRoute() {
  const viewerId = useSession().user?.id;
  useInvalidateOnFocus([challengeKeys.lists()]);
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Challenges',
        }}
      />
      <ChallengesScreen viewerId={viewerId} />
    </>
  );
}
