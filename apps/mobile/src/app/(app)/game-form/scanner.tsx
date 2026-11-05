import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { ScannerScreen } from '@/features/game-form/scanner-screen';
import { ScannerHeader } from '@/features/game-form/scanner-header';

export default function ScannerRoute() {
  const username = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Scan the QR code',
          header: () => <ScannerHeader />,
        }}
      />
      <ScannerScreen username={username} />
    </>
  );
}
