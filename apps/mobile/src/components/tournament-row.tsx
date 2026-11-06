import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tournament } from '@/api/types';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export interface TournamentRowProps {
  tournament: Tournament;
  onPress?(): void;
}

export function TournamentRow({ tournament, onPress }: TournamentRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${tournament.displayName}`}
      testID={`tournament-row-${tournament.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.names}>
        <Text style={styles.title} numberOfLines={1}>
          {tournament.displayName}
        </Text>
        <Text style={styles.slug} numberOfLines={1}>
          @{tournament.name}
        </Text>
        {tournament.group && (
          <Text
            style={styles.group}
            numberOfLines={1}
            testID={`tournament-row-${tournament.name}-group`}
            accessibilityLabel={`Group ${tournament.group.name}`}
          >
            GROUP · {tournament.group.name}
          </Text>
        )}
      </View>
      <Text style={styles.sport}>{tournament.sport.name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    ...Palette.card,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pressed: { opacity: 0.8 },
  names: { flex: 1, gap: Spacing.xs },
  title: { ...Typography.body, fontSize: 18 },
  slug: { ...Typography.caption },
  group: { ...Typography.caption, color: Colors.accent, fontWeight: '700', letterSpacing: 1 },
  sport: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '700' },
});
