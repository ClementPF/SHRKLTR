import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { AppInviteScreen } from '@/features/invites/app-invite-screen';
import { Colors } from '@/theme';

export default function AppInviteRoute() {
  const ownerId = useSession().user?.id;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Invite to Sharkulator',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <AppInviteScreen key={ownerId} ownerId={ownerId} />
    </>
  );
}
