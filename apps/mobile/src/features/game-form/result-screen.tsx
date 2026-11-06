import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { GameDetailScreen } from '@/features/games/game-detail-screen';
import { Spacing } from '@/theme';

/** Shown right after a submission: the durable game detail plus what to do next. */
export function GameResultScreen({ id, viewer }: { id: string | undefined; viewer?: string }) {
  return (
    <GameDetailScreen
      id={id}
      viewer={viewer}
      footer={
        <View style={styles.footer}>
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
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  footer: { gap: Spacing.md },
});
