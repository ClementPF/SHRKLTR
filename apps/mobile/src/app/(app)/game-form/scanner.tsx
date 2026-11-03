import { Stack } from 'expo-router';

import { useSession } from '@/auth/session';
import { ScannerScreen } from '@/features/game-form/scanner-screen';
import { Colors } from '@/theme';

export default function ScannerRoute() {
  const username = useSession().user?.username;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Scan the QR code',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <ScannerScreen username={username} />
    </>
  );
}
