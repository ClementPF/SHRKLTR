import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { AppInviteScreen } from '@/features/invites/app-invite-screen';

export default function AppInviteRoute() {
  const ownerId = useSession().user?.id;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Invite to Sharkulator',
        }}
      />
      <AppInviteScreen key={ownerId} ownerId={ownerId} />
    </>
  );
}
