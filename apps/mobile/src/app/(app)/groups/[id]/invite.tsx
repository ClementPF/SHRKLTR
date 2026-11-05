import { Stack, useLocalSearchParams } from 'expo-router';

import { GroupInviteScreen } from '@/features/groups/invite-screen';
import { Colors } from '@/theme';

export default function GroupInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Invite people',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <GroupInviteScreen key={id} id={id} />
    </>
  );
}
