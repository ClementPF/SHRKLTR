import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { WinnerScreen } from '@/features/game-form/winner-screen';
import { Colors } from '@/theme';

export default function WinnerRoute() {
  const username = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Winner',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <WinnerScreen username={username} />
    </>
  );
}
