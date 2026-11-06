import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { WinnerScreen } from '@/features/game-form/winner-screen';

export default function WinnerRoute() {
  const username = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Winner',
        }}
      />
      <WinnerScreen username={username} />
    </>
  );
}
