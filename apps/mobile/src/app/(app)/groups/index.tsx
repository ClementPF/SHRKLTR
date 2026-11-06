import { Stack } from 'expo-router';

import { GroupsScreen } from '@/features/groups/groups-screen';
import { groupKeys } from '@/features/groups/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';
import { Colors } from '@/theme';

export default function GroupsRoute() {
  useInvalidateOnFocus([groupKeys.list()]);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'My groups',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <GroupsScreen />
    </>
  );
}
