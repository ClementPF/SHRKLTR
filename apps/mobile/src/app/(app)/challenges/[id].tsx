import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { ChallengeDetailScreen } from '@/features/challenges/challenge-detail-screen';
import { challengeKeys } from '@/features/challenges/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function ChallengeDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const viewerId = useSession().user?.id;
  // The other player may have answered, or a game completed it, while this screen was behind.
  useInvalidateOnFocus([challengeKeys.detail(id ?? '')]);
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Challenge',
        }}
      />
      <ChallengeDetailScreen key={id} id={id} viewerId={viewerId} />
    </>
  );
}
