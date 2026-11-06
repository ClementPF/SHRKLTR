import { router, Stack } from 'expo-router';

import { CreateGroupScreen } from '@/features/groups/create-group-screen';

export default function NewGroupRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Create a group',
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
