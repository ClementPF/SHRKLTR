import { Stack, useLocalSearchParams } from 'expo-router';

import { AchievementsScreen } from '@/features/achievements/achievements-screen';

export default function AchievementsRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Achievements',
        }}
      />
      <AchievementsScreen key={username} username={username} />
    </>
  );
}
