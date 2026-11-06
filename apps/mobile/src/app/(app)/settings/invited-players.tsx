import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { InvitedPlayersScreen } from '@/features/invites/invited-players-screen';
import { Colors } from '@/theme';

export default function InvitedPlayersRoute() {
  const ownerId = useSession().user?.id;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Invited players',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <InvitedPlayersScreen key={ownerId} ownerId={ownerId} />
    </>
  );
}
