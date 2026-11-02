import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing, Typography } from '@/theme';

const GOLD = '#FFD700';

export interface TeamMember {
  username: string;
  /** Optional trailing detail, e.g. the points won or lost. */
  detail?: string;
}

export function TeamColumn({
  members,
  won,
  testID,
}: {
  members: readonly TeamMember[];
  won: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.column} testID={testID}>
      <SymbolView
        name={{ ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' }}
        tintColor={won ? GOLD : Colors.textMuted}
        size={28}
        accessibilityLabel={won ? 'Winners' : 'Losers'}
      />
      <View style={[styles.team, { borderColor: won ? GOLD : Colors.border }]}>
        {members.length === 0 && <Text style={styles.empty}>?</Text>}
        {members.map((m) => (
          <Text key={m.username} style={styles.player} numberOfLines={1}>
            {m.detail ? `${m.username} ${m.detail}` : m.username}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Winners and losers side by side, as on a game row. */
export function OutcomeColumns({
  winners,
  losers,
  testID,
}: {
  winners: readonly TeamMember[];
  losers: readonly TeamMember[];
  testID?: string;
}) {
  return (
    <View style={styles.versus} testID={testID}>
      <TeamColumn members={winners} won testID={testID && `${testID}-winners`} />
      <Text style={styles.vs}>VS</Text>
      <TeamColumn members={losers} won={false} testID={testID && `${testID}-losers`} />
    </View>
  );
}

const styles = StyleSheet.create({
  versus: { flexDirection: 'row', alignItems: 'center' },
  column: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  team: {
    alignSelf: 'stretch',
    marginHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderWidth: 3,
    borderRadius: 16,
    gap: Spacing.xs,
  },
  player: { ...Typography.body, textAlign: 'center' },
  empty: { ...Typography.body, textAlign: 'center', color: Colors.textMuted },
  vs: { fontSize: 24, fontWeight: '700', color: Colors.accent },
});
