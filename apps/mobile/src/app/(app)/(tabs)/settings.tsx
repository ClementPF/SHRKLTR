import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { versionLabel } from '@/lib/app-info';
import { Palette, Spacing, Typography } from '@/theme';

export default function SettingsScreen() {
  const { user, logout } = useSession();
  const [pending, setPending] = useState(false);

  const onLogout = async () => {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {user && <Text style={Typography.bodySecondary}>Signed in as {user.username}</Text>}
        <Button
          title="LOGOUT"
          loading={pending}
          onPress={() => void onLogout()}
          style={styles.button}
        />
      </View>
      <Text style={styles.version}>{versionLabel()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...Palette.screen, padding: Spacing.md },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  button: { width: 300, maxWidth: '100%' },
  version: { ...Typography.caption, textAlign: 'center' },
});
