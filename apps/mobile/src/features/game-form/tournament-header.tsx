import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { Tournament } from '@/api/types';
import { Button } from '@/components/button';
import { TournamentRow } from '@/components/tournament-row';
import { Colors, Spacing } from '@/theme';

export function openTournamentPicker() {
  router.push('/game-form/tournament');
}

/** Selected tournament with an EDIT action to re-pick it. */
export function GameFormTournamentHeader({
  tournament,
  loading,
}: {
  tournament: Tournament | null;
  loading: boolean;
}) {
  if (!tournament) {
    return loading ? (
      <ActivityIndicator color={Colors.text} style={styles.loading} />
    ) : (
      <Button
        title="Select a tournament"
        testID="game-form-select-tournament"
        onPress={openTournamentPicker}
      />
    );
  }
  return (
    <View style={styles.row} testID="game-form-tournament">
      <View style={styles.tournament}>
        <TournamentRow tournament={tournament} onPress={openTournamentPicker} />
      </View>
      <Button title="EDIT" testID="game-form-edit-tournament" onPress={openTournamentPicker} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tournament: { flex: 1 },
  loading: { padding: Spacing.md },
});
