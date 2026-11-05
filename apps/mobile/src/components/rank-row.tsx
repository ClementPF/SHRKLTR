import { Pressable, StyleSheet, Text } from 'react-native';

import { UnclaimedBadge } from '@/components/unclaimed-badge';
import { formatPoints } from '@/lib/format';
import { Colors, Spacing, Typography } from '@/theme';

export interface RankRowProps {
  position: number;
  name: string;
  score: number;
  /** Placeholder player added by name. */
  unclaimed?: boolean;
  onPress?(): void;
}

export function RankRow({ position, name, score, unclaimed = false, onPress }: RankRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Rank ${position} ${name}`}
      testID={`rank-row-${name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={styles.position}>{position}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {unclaimed && <UnclaimedBadge testID={`rank-row-${name}-unclaimed`} />}
      <Text style={styles.score}>{formatPoints(score)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
  },
  pressed: { opacity: 0.8 },
  position: { ...Typography.body, width: 28, color: Colors.textSecondary },
  name: { ...Typography.body, flex: 1 },
  score: { fontSize: 40, fontWeight: '700', color: Colors.textMuted },
});
