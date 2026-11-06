import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/theme';

import { useUnreadCount } from './queries';

export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Feed header bell: opens the inbox and shows how many notifications are unread. */
export function NotificationBell() {
  const count = useUnreadCount().data?.count ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      testID="notification-bell"
      onPress={() => router.push('/notifications')}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <SymbolView
        name={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }}
        tintColor={Colors.text}
        size={24}
      />
      {count > 0 && (
        <View style={styles.badge} testID="notification-bell-count">
          <Text style={styles.badgeText}>{unreadLabel(count)}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  pressed: { opacity: 0.6 },
  badge: {
    position: 'absolute',
    top: 0,
    right: Spacing.sm,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: Colors.text, fontSize: 11, fontWeight: '700' },
});
