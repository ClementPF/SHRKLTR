import { Stack, useLocalSearchParams } from 'expo-router';

import { AchievementsScreen } from '@/features/achievements/achievements-screen';
import { Colors } from '@/theme';

export default function AchievementsRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Achievements',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <AchievementsScreen key={username} username={username} />
    </>
  );
}
