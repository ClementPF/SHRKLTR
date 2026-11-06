import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';
import { tournamentKeys, useTournament } from '@/features/tournaments/queries';
import { TournamentScreen } from '@/features/tournaments/tournament-screen';
import { userKeys } from '@/features/users/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function TournamentDetailRoute() {
  const { name, displayName } = useLocalSearchParams<{ name: string; displayName?: string }>();
  const tournament = useTournament(name);
  const viewer = useSession().user?.username;
  useInvalidateOnFocus([tournamentKeys.all, userKeys.all]);
  return (
    <>
      <Stack.Screen
        options={{
          title: tournament.data?.displayName ?? displayName ?? name,
        }}
      />
      <TournamentScreen key={name} name={name} viewer={viewer} />
    </>
  );
}
