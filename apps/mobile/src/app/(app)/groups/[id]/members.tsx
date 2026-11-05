import { Stack, useLocalSearchParams } from 'expo-router';

import { GroupMembersScreen } from '@/features/groups/members-screen';
import { groupKeys } from '@/features/groups/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';
import { Colors } from '@/theme';

export default function GroupMembersRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useInvalidateOnFocus([groupKeys.group(id)]);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Members',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <GroupMembersScreen key={id} id={id} />
    </>
  );
}
