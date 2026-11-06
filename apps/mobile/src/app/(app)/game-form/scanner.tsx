import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { ScannerScreen } from '@/features/game-form/scanner-screen';
import { ScannerHeader } from '@/features/game-form/scanner-header';

export default function ScannerRoute() {
  const user = useSession().user;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Loser',
          header: () => <ScannerHeader />,
        }}
      />
      <ScannerScreen username={user?.username} userId={user?.id} />
    </>
  );
}
