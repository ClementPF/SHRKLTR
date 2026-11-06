import { Stack, useLocalSearchParams } from 'expo-router';

import { GroupInviteScreen } from '@/features/groups/invite-screen';

export default function GroupInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Invite people',
        }}
      />
      <GroupInviteScreen key={id} id={id} />
    </>
  );
}
