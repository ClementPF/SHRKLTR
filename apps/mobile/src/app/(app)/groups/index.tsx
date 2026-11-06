import { Stack } from 'expo-router';

import { GroupsScreen } from '@/features/groups/groups-screen';
import { groupKeys } from '@/features/groups/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function GroupsRoute() {
  useInvalidateOnFocus([groupKeys.list()]);
  return (
    <>
      <Stack.Screen
        options={{
          title: 'My groups',
        }}
      />
      <GroupsScreen />
    </>
  );
}
