import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { ScannerScreen } from '@/features/game-form/scanner-screen';

export default function ScannerRoute() {
  const user = useSession().user;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Loser',
        }}
      />
      <ScannerScreen username={user?.username} userId={user?.id} />
    </>
  );
}
