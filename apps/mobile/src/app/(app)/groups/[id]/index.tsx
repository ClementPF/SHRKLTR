import { Stack, useLocalSearchParams } from 'expo-router';

import { GroupScreen } from '@/features/groups/group-screen';
import { groupKeys, useGroup } from '@/features/groups/queries';
import { tournamentKeys } from '@/features/tournaments/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function GroupRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  useInvalidateOnFocus([groupKeys.group(id), tournamentKeys.all]);
  return (
    <>
      <Stack.Screen
        options={{
          title: group.data?.name ?? 'Group',
        }}
      />
      <GroupScreen key={id} id={id} />
    </>
  );
}
