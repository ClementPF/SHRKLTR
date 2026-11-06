import { router, Stack } from 'expo-router';

import { CreateGroupScreen } from '@/features/groups/create-group-screen';
import { Colors } from '@/theme';

export default function NewGroupRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Create a group',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <CreateGroupScreen
        onCreated={(group) =>
          router.replace({ pathname: '/groups/[id]', params: { id: group.id } })
        }
      />
    </>
  );
}
