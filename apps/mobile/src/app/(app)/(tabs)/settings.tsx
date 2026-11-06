import { router, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/auth/session';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { versionLabel } from '@/lib/app-info';
import { Colors, Palette, Spacing, Typography } from '@/theme';

const LOGOUT_TITLE = 'Log out?';
const LOGOUT_MESSAGE = "You'll need to sign in again to record games on this device.";

const LINKS: { label: string; href: Href }[] = [
  { label: 'Notifications', href: '/settings/notifications' },
  { label: 'Invite to Sharkulator', href: '/settings/invite' },
  { label: 'Invited players', href: '/settings/invited-players' },
];

function Row({
  label,
  onPress,
  destructive = false,
  last = false,
}: {
  label: string;
  onPress(): void;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}
    >
      <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
      {!destructive && (
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          tintColor={Colors.textMuted}
          size={16}
        />
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { user, logout } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const onLogout = async () => {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      {user && <Text style={styles.signedIn}>Signed in as {user.username}</Text>}
      <View style={styles.group}>
        {LINKS.map((link, index) => (
          <Row
            key={link.label}
            label={link.label}
            last={index === LINKS.length - 1}
            onPress={() => router.push(link.href)}
          />
        ))}
      </View>
      <View style={styles.group}>
        <Row label="Log out" destructive last onPress={() => setConfirming(true)} />
      </View>
      <Text style={styles.version}>{versionLabel()}</Text>
      <ConfirmDialog
        visible={confirming}
        title={LOGOUT_TITLE}
        message={LOGOUT_MESSAGE}
        confirmTitle="Log out"
        loading={pending}
        onConfirm={() => void onLogout()}
        onCancel={() => setConfirming(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.lg },
  signedIn: { ...Typography.bodySecondary, paddingHorizontal: Spacing.xs },
  group: { ...Palette.card, padding: 0, overflow: 'hidden' },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  pressed: { backgroundColor: Colors.surfaceRaised },
  rowLabel: { ...Typography.body },
  destructive: { color: Colors.accent, fontWeight: '700' },
  version: { ...Typography.caption, textAlign: 'center' },
});
