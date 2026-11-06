import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { TournamentPickerScreen } from '@/features/game-form/tournament-picker-screen';

export default function TournamentPickerRoute() {
  const username = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Tournament',
        }}
      />
      <TournamentPickerScreen username={username} />
    </>
  );
}
