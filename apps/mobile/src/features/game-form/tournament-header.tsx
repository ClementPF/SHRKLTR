import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tournament } from '@/api/types';
import { Button } from '@/components/button';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export function openTournamentPicker() {
  router.push('/game-form/tournament');
}

/** Selected tournament; tapping it opens the picker to choose another. */
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
    <View testID="game-form-tournament">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change tournament, ${tournament.displayName}`}
        testID="game-form-edit-tournament"
        onPress={openTournamentPicker}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.names}>
          <Text style={styles.title} numberOfLines={1}>
            {tournament.displayName}
          </Text>
          <Text style={styles.caption} numberOfLines={1}>
            {tournament.group
              ? `${tournament.sport.name} · ${tournament.group.name}`
              : tournament.sport.name}
          </Text>
        </View>
        <Text style={styles.change}>Change</Text>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          tintColor={Colors.textMuted}
          size={16}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { ...Palette.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pressed: { opacity: 0.8 },
  names: { flex: 1, gap: Spacing.xs },
  title: { ...Typography.body, fontSize: 18, fontWeight: '700' },
  caption: { ...Typography.caption, textTransform: 'capitalize' },
  change: { ...Typography.caption, color: Colors.textSecondary },
  loading: { padding: Spacing.md },
});
