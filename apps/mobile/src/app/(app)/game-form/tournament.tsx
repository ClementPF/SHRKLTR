import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { TournamentPickerScreen } from '@/features/game-form/tournament-picker-screen';
import { Colors } from '@/theme';

export default function TournamentPickerRoute() {
  const username = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Select Tournament',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <TournamentPickerScreen username={username} />
    </>
  );
}
