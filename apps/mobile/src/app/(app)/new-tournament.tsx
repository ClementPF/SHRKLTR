import { router, Stack, useLocalSearchParams } from 'expo-router';

import { CreateTournamentScreen } from '@/features/tournaments/create-tournament-screen';
import { Colors } from '@/theme';

export default function NewTournamentRoute() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
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
        initialGroupId={groupId}
        onCreated={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/tournaments');
        }}
      />
    </>
  );
}
