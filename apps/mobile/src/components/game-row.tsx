import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Game, Outcome } from '@/api/types';
import { useRivalry } from '@/features/users/queries';
import { formatPoints, fromNow } from '@/lib/format';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { RivalryRows } from './rivalry-card';

const GOLD = '#FFD700';

function OutcomeColumn({ outcomes, won }: { outcomes: Outcome[]; won: boolean }) {
  return (
    <View style={styles.column} testID={won ? 'game-winners' : 'game-losers'}>
      <SymbolView
        name={{ ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' }}
        tintColor={won ? GOLD : Colors.textMuted}
        size={28}
        accessibilityLabel={won ? 'Winners' : 'Losers'}
      />
      <View style={[styles.team, { borderColor: won ? GOLD : Colors.border }]}>
        {outcomes.map((o) => (
          <Text key={o.id} style={styles.player} numberOfLines={1}>
            {o.user.username}
          </Text>
        ))}
      </View>
    </View>
  );
}

function LiveRivalry({
  username,
  rivalName,
  tournamentName,
}: {
  username: string;
  rivalName: string;
  tournamentName: string;
}) {
  const { data, isPending, isError } = useRivalry(username, rivalName, tournamentName, true);
  if (isPending) return <ActivityIndicator color={Colors.text} />;
  if (isError) return <Text style={styles.notice}>Failed to load the rivalry.</Text>;
  if (!data) {
    return (
      <Text style={styles.notice}>
        NO RIVALRY BETWEEN {username} AND {rivalName} FOR {tournamentName}
      </Text>
    );
  }
  return <RivalryRows rivalry={data} />;
}

/**
 * Rivalries are shown from the viewer's side when they played, else from the first winner's,
 * against every player of the opposite team.
 */
export function rivalryPairs(game: Game, viewer: string | undefined) {
  const subject =
    game.outcomes.find((o) => o.user.username === viewer) ??
    game.outcomes.find((o) => o.result === 'WIN');
  if (!subject) return [];
  return game.outcomes
    .filter((o) => o.result !== subject.result)
    .map((o) => ({ username: subject.user.username, rivalName: o.user.username }));
}

export interface GameRowProps {
  game: Game;
  viewer?: string;
}

export function GameRow({ game, viewer }: GameRowProps) {
  const [expanded, setExpanded] = useState(false);
  const winners = game.outcomes.filter((o) => o.result === 'WIN');
  const losers = game.outcomes.filter((o) => o.result === 'LOSS');
  const points = Math.abs(winners[0]?.scoreValue ?? game.outcomes[0]?.scoreValue ?? 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      testID={`game-row-${game.id}`}
      onPress={() => setExpanded((v) => !v)}
      style={styles.card}
    >
      <View style={styles.ghost} pointerEvents="none">
        <Text style={styles.ghostText} testID="game-points">
          {formatPoints(points)}
        </Text>
      </View>
      <Text style={styles.date}>{fromNow(game.date)}</Text>
      <Text style={styles.tournament}>{game.tournament.displayName}</Text>
      <View style={styles.versus}>
        <OutcomeColumn outcomes={winners} won />
        <Text style={styles.vs}>VS</Text>
        <OutcomeColumn outcomes={losers} won={false} />
      </View>
      {expanded && (
        <View style={styles.rivalry} testID="game-rivalry">
          <Text style={styles.rivalryTitle}>RIVALRY</Text>
          {rivalryPairs(game, viewer).map((pair) => (
            <LiveRivalry
              key={`${pair.username}-${pair.rivalName}`}
              tournamentName={game.tournament.name}
              {...pair}
            />
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, overflow: 'hidden', gap: Spacing.sm },
  ghost: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontSize: 140, fontWeight: '700', color: Colors.surfaceRaised },
  date: { ...Typography.caption },
  tournament: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
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
  vs: { fontSize: 24, fontWeight: '700', color: Colors.accent },
  rivalry: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  rivalryTitle: { ...Typography.body, fontWeight: '700', textAlign: 'center', letterSpacing: 2 },
  notice: { ...Typography.caption, textAlign: 'center' },
});
