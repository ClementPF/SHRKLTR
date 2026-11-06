import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GroupRole, User } from '@/api/types';
import { EmptyState } from '@/components/list-parts';
import { UnclaimedBadge } from '@/components/unclaimed-badge';
import { displayName } from '@/lib/users';
import { Colors, Radius, Spacing, Typography } from '@/theme';

export const GROUP_NOT_FOUND_TEXT = "This group doesn't exist or you can't see it.";
export const GROUP_LOAD_FAILED_TEXT = "Couldn't load this group.";

export const ROLE_LABELS: Record<GroupRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

export function RoleBadge({ role, testID }: { role: GroupRole; testID?: string }) {
  return (
    <Text
      style={[styles.badge, role === 'OWNER' && styles.owner]}
      testID={testID}
      accessibilityLabel={`Role ${ROLE_LABELS[role]}`}
    >
      {role}
    </Text>
  );
}

/** The ordinary not-found state, shown for unknown groups and groups you can't see alike. */
export function GroupNotFound() {
  return (
    <EmptyState
      title={GROUP_NOT_FOUND_TEXT}
      actionTitle="Go to my groups"
      onAction={() => router.replace('/groups')}
    />
  );
}

export function GroupLoadFailed({ onRetry }: { onRetry(): void }) {
  return <EmptyState title={GROUP_LOAD_FAILED_TEXT} actionTitle="Retry" onAction={onRetry} />;
}

export interface PersonRowProps {
  user: User;
  role?: GroupRole;
  unclaimed?: boolean;
  testID?: string;
  onPress?(): void;
}

/** One member or unclaimed player: name, @username and role or unclaimed label. */
export function PersonRow({ user, role, unclaimed = false, testID, onPress }: PersonRowProps) {
  const name = displayName(user);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={role ? `${name}, ${ROLE_LABELS[role]}` : name}
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.names}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.username} numberOfLines={1}>
          @{user.username}
        </Text>
      </View>
      {role && <RoleBadge role={role} testID={testID ? `${testID}-role` : undefined} />}
      {unclaimed && <UnclaimedBadge testID={testID ? `${testID}-unclaimed` : undefined} />}
    </Pressable>
  );
}

export function openProfile(username: string) {
  router.push({ pathname: '/user/[username]', params: { username } });
}

const styles = StyleSheet.create({
  badge: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: Colors.textSecondary,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  owner: { color: Colors.accent, borderColor: Colors.accent },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
  },
  pressed: { opacity: 0.8 },
  names: { flex: 1, gap: 2 },
  name: { ...Typography.body },
  username: { ...Typography.caption },
});
