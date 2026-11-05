import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export interface UserTileProps {
  username: string;
  wins: number;
  games: number;
  /** Shows the ⚔️ challenged state. */
  challenged?: boolean;
  /** When set, tapping the avatar challenges the user. */
  onChallenge?(): void;
  challenging?: boolean;
  /** Placeholder player added by name: labeled, and never challengeable. */
  unclaimed?: boolean;
}

function Badge({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeLabel}>{label}</Text>
      <Text style={styles.badgeValue}>{value}</Text>
    </View>
  );
}

function initials(username: string): string {
  const dash = username.indexOf('-');
  return (username.charAt(0) + (dash >= 0 ? username.charAt(dash + 1) : '')).toUpperCase();
}

export function UserTile({
  username,
  wins,
  games,
  challenged = false,
  onChallenge,
  challenging = false,
  unclaimed = false,
}: UserTileProps) {
  const avatar = (
    <View style={styles.avatar}>
      <Text style={styles.initials}>{initials(username)}</Text>
    </View>
  );
  return (
    <View style={styles.container} testID="user-tile">
      {challenged && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.swords} testID="challenged-state">
            ⚔️
          </Text>
        </View>
      )}
      <Badge label="WINS" value={wins} />
      <View style={styles.center}>
        {onChallenge && !unclaimed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Challenge ${username}`}
            accessibilityState={{ disabled: challenged || challenging, busy: challenging }}
            disabled={challenged || challenging}
            onPress={onChallenge}
          >
            {avatar}
          </Pressable>
        ) : (
          avatar
        )}
        <Text style={styles.username}>{username}</Text>
        {unclaimed && (
          <Text style={styles.unclaimed} testID="user-tile-unclaimed">
            UNCLAIMED PLAYER
          </Text>
        )}
        {onChallenge && !unclaimed && (
          <Text style={styles.hint}>
            {challenged ? 'CHALLENGED' : challenging ? 'CHALLENGING…' : 'TAP TO CHALLENGE'}
          </Text>
        )}
      </View>
      <Badge label="GAMES" value={games} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 140,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
  },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  swords: { fontSize: 92, opacity: 0.6 },
  badge: {
    minWidth: 64,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.background,
  },
  badgeLabel: { ...Typography.caption, color: Colors.text, fontWeight: '700' },
  badgeValue: { ...Typography.body, fontWeight: '700' },
  center: { alignItems: 'center', gap: Spacing.xs },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.text,
  },
  initials: { ...Typography.body, fontSize: 22, fontWeight: '700' },
  username: { ...Typography.body, fontWeight: '700' },
  hint: { ...Typography.caption, color: Colors.text, letterSpacing: 1 },
  unclaimed: {
    ...Typography.caption,
    color: Colors.text,
    fontWeight: '700',
    letterSpacing: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
});
