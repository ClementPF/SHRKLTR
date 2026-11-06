import { Stack, useLocalSearchParams } from 'expo-router';

import { GroupMembersScreen } from '@/features/groups/members-screen';
import { groupKeys } from '@/features/groups/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function GroupMembersRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useInvalidateOnFocus([groupKeys.group(id)]);
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Members',
        }}
      />
      <GroupMembersScreen key={id} id={id} />
    </>
  );
}
