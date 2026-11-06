import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Game, Outcome } from '@/api/types';
import { GameRivalries } from '@/components/game-row';
import { CenteredLoading, EmptyState, SectionTitle } from '@/components/list-parts';
import { OutcomeColumns } from '@/components/outcome-columns';
import { UnclaimedBadge } from '@/components/unclaimed-badge';
import { openUserDetail } from '@/features/feed/list-items';
import { useEvictWhenDenied } from '@/features/groups/use-group-access';
import { formatPoints, fromNow, gameDate, signedElo } from '@/lib/format';
import { isPlaceholder } from '@/lib/users';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { GameShareActions, isGameParticipant } from './game-share';
import { isGameMissing, useGame } from './queries';

export const GAME_NOT_FOUND_TEXT = "This game doesn't exist or you can't see it.";
export const GAME_LOAD_FAILED_TEXT = "Couldn't load this game.";

export interface GameDetailScreenProps {
  id: string | undefined;
  /** Username of the signed-in user: orients the rivalry and lets participants share. */
  viewer?: string;
  /** Actions on the game itself, such as sharing it. */
  actions?: ReactNode;
  footer?: ReactNode;
}

const members = (outcomes: readonly Outcome[], result: Outcome['result']) =>
  outcomes
    .filter((o) => o.result === result)
    .map((o) => ({
      username: o.user.username,
      detail: signedElo(o.scoreValue),
      unclaimed: isPlaceholder(o.user),
    }));

function OutcomeLine({ outcome, tournamentName }: { outcome: Outcome; tournamentName: string }) {
  const { user, result, scoreValue, ratingBefore } = outcome;
  const won = result === 'WIN';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${user.username}`}
      testID={`outcome-${user.username}`}
      onPress={() => openUserDetail(user.username, tournamentName)}
      style={({ pressed }) => [styles.outcome, pressed && styles.pressed]}
    >
      <View style={styles.outcomeName}>
        <Text style={styles.username} numberOfLines={1}>
          {user.username}
        </Text>
        {isPlaceholder(user) && <UnclaimedBadge />}
      </View>
      <Text style={[styles.result, { color: won ? Colors.success : Colors.accent }]}>{result}</Text>
      {ratingBefore !== null && (
        <Text style={styles.rating}>
          {`${formatPoints(ratingBefore)} → ${formatPoints(ratingBefore + scoreValue)}`}
        </Text>
      )}
      <Text style={[styles.delta, { color: won ? Colors.success : Colors.accent }]}>
        {signedElo(scoreValue)}
      </Text>
    </Pressable>
  );
}

function GameDetail({ game, viewer, actions, footer }: GameDetailScreenProps & { game: Game }) {
  const { tournament } = game;
  // Winners first so the list reads like the columns above it.
  const outcomes = [...game.outcomes].sort((a, b) => b.scoreValue - a.scoreValue);
  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      testID={`game-detail-${game.id}`}
    >
      <View style={styles.card}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open tournament ${tournament.displayName}`}
          onPress={() =>
            router.push({
              pathname: '/tournament/[name]',
              params: { name: tournament.name, displayName: tournament.displayName },
            })
          }
        >
          <Text style={styles.tournament}>{tournament.displayName}</Text>
        </Pressable>
        <Text style={styles.sport}>{tournament.sport.name}</Text>
        <Text style={styles.date}>{gameDate(game.date)}</Text>
        <Text style={styles.caption}>{fromNow(game.date)}</Text>
        <OutcomeColumns
          testID="game-detail-outcomes"
          winners={members(game.outcomes, 'WIN')}
          losers={members(game.outcomes, 'LOSS')}
        />
      </View>
      {isGameParticipant(game, viewer) && <GameShareActions game={game} />}
      {actions}
      <SectionTitle title="ELO CHANGES" />
      <View style={styles.outcomes}>
        {outcomes.map((o) => (
          <OutcomeLine key={o.id} outcome={o} tournamentName={tournament.name} />
        ))}
      </View>
      <SectionTitle title="RIVALRY" />
      <View style={styles.card} testID="game-detail-rivalry">
        <GameRivalries game={game} viewer={viewer} />
      </View>
      {footer}
    </ScrollView>
  );
}

/** A saved game, always read from GET /games/:id (a submission only pre-fills the cache). */
export function GameDetailScreen(props: GameDetailScreenProps) {
  const { id } = props;
  const game = useGame(id);
  const missing = isGameMissing(game.error);
  // A failed refetch keeps the last data, which tells which tournament and group were lost.
  const tournament = id && game.data?.id === id ? game.data.tournament : undefined;
  useEvictWhenDenied(missing, tournament?.name, tournament?.group?.id);

  if (!id || missing) {
    return (
      <EmptyState
        title={GAME_NOT_FOUND_TEXT}
        actionTitle="Back to feed"
        onAction={() => router.navigate('/feed')}
      />
    );
  }
  // The cache is keyed by id, so a pending query never holds another game's data.
  if (game.data?.id === id) return <GameDetail {...props} game={game.data} />;
  if (game.isError) {
    return (
      <EmptyState
        title={GAME_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void game.refetch()}
      />
    );
  }
  return (
    <View style={Palette.screen} testID="game-detail-loading">
      <CenteredLoading />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  card: { ...Palette.card, gap: Spacing.sm },
  tournament: { ...Typography.title, textAlign: 'center' },
  sport: { ...Typography.bodySecondary, textAlign: 'center', textTransform: 'capitalize' },
  date: { ...Typography.body, textAlign: 'center' },
  caption: { ...Typography.caption, textAlign: 'center' },
  outcomes: { ...Palette.card, padding: 0, overflow: 'hidden' },
  outcome: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pressed: { opacity: 0.8 },
  outcomeName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  username: { ...Typography.body, flexShrink: 1 },
  result: { ...Typography.caption, fontWeight: '700' },
  rating: { ...Typography.caption, color: Colors.textSecondary },
  delta: { ...Typography.body, fontWeight: '700', minWidth: 56, textAlign: 'right' },
});
