import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Stats } from '@/api/types';
import { describeStreak, formatPoints, rivalryLabel } from '@/lib/format';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export function StatRow({ name, value }: { name: string; value: string | number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export interface StatsCardProps {
  stats: Stats;
  onPress?(): void;
}

export function StatsCard({ stats, onPress }: StatsCardProps) {
  const streak = describeStreak(stats);
  const card = (
    <View style={styles.card} testID={`stats-card-${stats.tournament.name}`}>
      <Text style={styles.title}>{stats.tournament.displayName}</Text>
      <View style={styles.divider} />
      <StatRow name="Score" value={formatPoints(stats.score)} />
      <StatRow name="Best Score" value={formatPoints(stats.bestScore)} />
      <StatRow name="Game Count" value={stats.gameCount} />
      <StatRow name={streak.label} value={streak.value} />
      <StatRow name="Longest Winning Streak" value={stats.longestWinStreak} />
      <StatRow name="Longest Losing Streak" value={stats.longestLoseStreak} />
      <StatRow name="The Freaking Shark" value={rivalryLabel(stats.worstRivalry, '❌🦈')} />
      <StatRow name="The Smelly Fish" value={rivalryLabel(stats.bestRivalry, '❌🎣')} />
    </View>
  );
  if (!onPress) return card;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stats.tournament.displayName} stats`}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, gap: Spacing.xs },
  title: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '700' },
  value: { ...Typography.body },
  pressed: { opacity: 0.8 },
});
