import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { ChallengeDetailScreen } from '@/features/challenges/challenge-detail-screen';
import { challengeKeys } from '@/features/challenges/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';
import { Colors } from '@/theme';

export default function ChallengeDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const viewerId = useSession().user?.id;
  // The other player may have answered, or a game completed it, while this screen was behind.
  useInvalidateOnFocus([challengeKeys.detail(id ?? '')]);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Challenge',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <ChallengeDetailScreen key={id} id={id} viewerId={viewerId} />
    </>
  );
}
