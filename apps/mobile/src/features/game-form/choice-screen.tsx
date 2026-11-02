import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Palette, Spacing, Typography } from '@/theme';

export const GAME_OVER_TEXT = 'The game is over… did you win or lose?';

export function GameChoiceScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{GAME_OVER_TEXT}</Text>
      <Text style={styles.subtitle}>
        Good game or not, it&apos;s time to find out how many points it was worth.
      </Text>
      <Button
        title="WON"
        testID="game-choice-won"
        onPress={() => router.push('/game-form/winner')}
        style={styles.button}
      />
      <Button
        title="LOST"
        testID="game-choice-lost"
        onPress={() => router.push('/game-form/scanner')}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...Palette.screen,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: { ...Typography.title, fontSize: 22, textAlign: 'center' },
  subtitle: { ...Typography.bodySecondary, textAlign: 'center' },
  button: { width: 300, maxWidth: '100%' },
});
