import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { InvitedPlayersScreen } from '@/features/invites/invited-players-screen';

export default function InvitedPlayersRoute() {
  const ownerId = useSession().user?.id;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Invited players',
        }}
      />
      <InvitedPlayersScreen key={ownerId} ownerId={ownerId} />
    </>
  );
}
