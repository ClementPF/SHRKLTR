import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { GameDetailScreen } from '@/features/games/game-detail-screen';
import { Spacing } from '@/theme';

// The tabs are still under this screen; going back to them refreshes the feed on focus.
const backToFeed = () => router.dismissTo('/feed');

/** Shown right after a submission: the durable game detail plus what to do next. */
export function GameResultScreen({ id, viewer }: { id: string | undefined; viewer?: string }) {
  // Android's back button would reopen "did you win or lose?" under this screen.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        backToFeed();
        return true;
      });
      return () => subscription.remove();
    }, []),
  );
  return (
    <GameDetailScreen
      id={id}
      viewer={viewer}
      footer={
        <View style={styles.footer}>
          <Button title="Back to feed" testID="result-back-to-feed" onPress={backToFeed} />
          <Button
            title="Add another game"
            variant="secondary"
            onPress={() => router.dismissTo('/add-game')}
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  footer: { gap: Spacing.md },
});
