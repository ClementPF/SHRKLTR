import { router, Stack } from 'expo-router';

import { CreateTournamentScreen } from '@/features/tournaments/create-tournament-screen';
import { Colors } from '@/theme';

export default function NewTournamentRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Create a Tournament',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <CreateTournamentScreen
        onCreated={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/tournaments');
        }}
      />
    </>
  );
}
