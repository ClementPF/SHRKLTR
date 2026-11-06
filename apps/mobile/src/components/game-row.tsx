import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Game } from '@/api/types';
import { isNotFound } from '@/features/groups/queries';
import { useEvictWhenDenied } from '@/features/groups/use-group-access';
import { useRivalry } from '@/features/users/queries';
import { formatPoints, fromNow } from '@/lib/format';
import { isPlaceholder } from '@/lib/users';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { TeamColumn } from './outcome-columns';
import { RivalryRows } from './rivalry-card';

export function noRivalryText(username: string, rivalName: string, tournament: string): string {
  return `No rivalry between ${username} and ${rivalName} in ${tournament} yet.`;
}

function LiveRivalry({
  username,
  rivalName,
  tournamentName,
  tournamentDisplayName,
}: {
  username: string;
  rivalName: string;
  tournamentName: string;
  tournamentDisplayName: string;
}) {
  const { data, isPending, isError, error } = useRivalry(username, rivalName, tournamentName, true);
  useEvictWhenDenied(isNotFound(error), tournamentName);
  if (isPending) return <ActivityIndicator color={Colors.text} />;
  if (isError) return <Text style={styles.notice}>Failed to load the rivalry.</Text>;
  if (!data) {
    return (
      <Text style={styles.notice}>{noRivalryText(username, rivalName, tournamentDisplayName)}</Text>
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

/** Live rivalries between the subject of {@link rivalryPairs} and each opponent. */
export function GameRivalries({ game, viewer }: { game: Game; viewer: string | undefined }) {
  return rivalryPairs(game, viewer).map((pair) => (
    <LiveRivalry
      key={`${pair.username}-${pair.rivalName}`}
      tournamentName={game.tournament.name}
      tournamentDisplayName={game.tournament.displayName}
      {...pair}
    />
  ));
}

export interface GameRowProps {
  game: Game;
  viewer?: string;
  /** Tapping reveals live rivalries, which need a session; public pages turn it off. */
  expandable?: boolean;
  /** Replaces the rivalry toggle, e.g. to open the game's own screen. */
  onPress?(): void;
}

const toMember = (o: Game['outcomes'][number]) => ({
  username: o.user.username,
  unclaimed: isPlaceholder(o.user),
});

export function GameRow({ game, viewer, expandable = true, onPress }: GameRowProps) {
  const [expanded, setExpanded] = useState(false);
  const winners = game.outcomes.filter((o) => o.result === 'WIN');
  const losers = game.outcomes.filter((o) => o.result === 'LOSS');
  const points = Math.abs(winners[0]?.scoreValue ?? game.outcomes[0]?.scoreValue ?? 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={onPress ? undefined : { expanded }}
      accessibilityHint={onPress ? 'Opens the game' : undefined}
      testID={`game-row-${game.id}`}
      disabled={!onPress && !expandable}
      onPress={onPress ?? (() => setExpanded((v) => !v))}
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
        <TeamColumn members={winners.map(toMember)} won testID="game-winners" />
        <Text style={styles.vs}>VS</Text>
        <TeamColumn members={losers.map(toMember)} won={false} testID="game-losers" />
      </View>
      {expanded && (
        <View style={styles.rivalry} testID="game-rivalry">
          <Text style={styles.rivalryTitle}>RIVALRY</Text>
          <GameRivalries game={game} viewer={viewer} />
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
