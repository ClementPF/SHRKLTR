import { StyleSheet, Text, View } from 'react-native';

import type { RivalryStats } from '@/api/types';
import { describeStreak, formatPoints } from '@/lib/format';
import { Colors, Palette, Spacing, Typography } from '@/theme';

function RivalryRow({
  name,
  left,
  right,
}: {
  name: string;
  left: string | number;
  right: string | number;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.value}>{left}</Text>
      <Text style={styles.name}>{name}</Text>
      <Text style={[styles.value, styles.right]}>{right}</Text>
    </View>
  );
}

/** Head-to-head stats of `rivalry.user` (left column) against `rivalry.rival` (right). */
export function RivalryRows({ rivalry }: { rivalry: RivalryStats }) {
  const streak = describeStreak(rivalry);
  return (
    <View style={styles.rows}>
      <RivalryRow name="" left={rivalry.user.username} right={rivalry.rival.username} />
      <RivalryRow
        name="Total Points"
        left={formatPoints(rivalry.score)}
        right={formatPoints(-rivalry.score)}
      />
      <RivalryRow name="Game Count" left={rivalry.gameCount} right={rivalry.gameCount} />
      <RivalryRow name="Win Count" left={rivalry.winCount} right={rivalry.loseCount} />
      <RivalryRow
        name={streak.label}
        left={Math.max(rivalry.winStreak, rivalry.loseStreak, rivalry.tieStreak)}
        right={Math.min(rivalry.winStreak, rivalry.loseStreak, rivalry.tieStreak)}
      />
      <RivalryRow
        name="Longest Win Streak"
        left={rivalry.longestWinStreak}
        right={rivalry.longestLoseStreak}
      />
    </View>
  );
}

export function RivalryCard({ rivalry }: { rivalry: RivalryStats }) {
  return (
    <View style={styles.card} testID={`rivalry-card-${rivalry.id}`}>
      <Text style={styles.title}>RIVALRY</Text>
      <Text style={styles.subtitle}>{rivalry.tournament.displayName}</Text>
      <RivalryRows rivalry={rivalry} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, gap: Spacing.xs },
  title: { ...Typography.body, fontWeight: '700', textAlign: 'center', letterSpacing: 2 },
  subtitle: { ...Typography.caption, textAlign: 'center' },
  rows: { gap: Spacing.xs, alignSelf: 'stretch' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '700',
    flex: 2,
    textAlign: 'center',
  },
  value: { ...Typography.body, flex: 1 },
  right: { textAlign: 'right' },
});
