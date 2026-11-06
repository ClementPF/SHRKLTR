import { router, Stack, useLocalSearchParams } from 'expo-router';

import { CreateTournamentScreen } from '@/features/tournaments/create-tournament-screen';

export default function NewTournamentRoute() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Create a tournament',
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
