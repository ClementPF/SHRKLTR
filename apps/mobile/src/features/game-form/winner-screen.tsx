import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { QrDisplay } from '@/components/qr-display';
import { StayAwake } from '@/components/stay-awake';
import { buildQrPayload, encodeQrPayload } from '@/lib/qr';
import { Palette, Spacing, Typography } from '@/theme';

import { useGameFormTournament } from './queries';
import { GameFormTournamentHeader } from './tournament-header';

export const WINNER_TEXT =
  "Check you out, you won! Well, it's not a win until you get them sweet points. Make sure the loser scans this QR code and submits the game.";
export const WINNER_TEAM_TEXT =
  'Team game (2v2, 3v3…)? Every winner shows their own code to the loser who submits.';
export const WINNER_DONE_TEXT =
  'Scanned? The game shows up in your feed once the loser submits it.';

export function WinnerScreen({ username }: { username: string | undefined }) {
  const { tournament, loading } = useGameFormTournament(username);
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Spacing.md + insets.bottom }]}
    >
      <GameFormTournamentHeader tournament={tournament} loading={loading} />
      {tournament && username && (
        <>
          <StayAwake />
          <Text style={styles.text}>{WINNER_TEXT}</Text>
          <QrDisplay value={encodeQrPayload(buildQrPayload(username, tournament.name, 'WIN'))} />
          <Text style={styles.caption}>{WINNER_TEAM_TEXT}</Text>
          <Text style={styles.caption}>{WINNER_DONE_TEXT}</Text>
          <Button
            title="Done"
            variant="secondary"
            testID="winner-done"
            // Back to the feed already under this screen, so it refreshes on focus.
            onPress={() => router.dismissTo('/feed')}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  text: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
  caption: { ...Typography.caption, textAlign: 'center' },
});
