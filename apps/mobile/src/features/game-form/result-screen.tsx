import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import type { Outcome } from '@/api/types';
import { Button } from '@/components/button';
import { GameRow } from '@/components/game-row';
import { EmptyState, SectionTitle } from '@/components/list-parts';
import { OutcomeColumns } from '@/components/outcome-columns';
import { isPlaceholder } from '@/lib/users';
import { Palette, Spacing } from '@/theme';

import { useSubmittedGame } from './queries';

export const RESULT_MISSING_TEXT = 'This game result is no longer available.';

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;

const members = (outcomes: readonly Outcome[], result: Outcome['result']) =>
  outcomes
    .filter((o) => o.result === result)
    .map((o) => ({
      username: o.user.username,
      detail: signed(o.scoreValue),
      unclaimed: isPlaceholder(o.user),
    }));

export function GameResultScreen({ id, viewer }: { id: string | undefined; viewer?: string }) {
  const { data: game } = useSubmittedGame(id);
  if (!game) {
    return (
      <EmptyState
        title={RESULT_MISSING_TEXT}
        actionTitle="Back to feed"
        onAction={() => router.navigate('/feed')}
      />
    );
  }
  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <SectionTitle title="RESULTS" />
      <GameRow game={game} viewer={viewer} />
      <OutcomeColumns
        testID="result-outcomes"
        winners={members(game.outcomes, 'WIN')}
        losers={members(game.outcomes, 'LOSS')}
      />
      <Button
        title="Back to feed"
        testID="result-back-to-feed"
        onPress={() => router.navigate('/feed')}
      />
      <Button
        title="Add another game"
        variant="secondary"
        onPress={() => router.navigate('/add-game')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
});
