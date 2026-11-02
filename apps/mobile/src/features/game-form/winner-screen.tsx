import { ScrollView, StyleSheet, Text } from 'react-native';

import { QrDisplay } from '@/components/qr-display';
import { buildQrPayload, encodeQrPayload } from '@/lib/qr';
import { Palette, Spacing, Typography } from '@/theme';

import { useGameFormTournament } from './queries';
import { GameFormTournamentHeader } from './tournament-header';

export const WINNER_TEXT =
  "Check you out, you won! Well, it's not a win until you get them sweet points. Make sure the loser scans this QR code and submits the game.";

export function WinnerScreen({ username }: { username: string | undefined }) {
  const { tournament, loading } = useGameFormTournament(username);
  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <GameFormTournamentHeader tournament={tournament} loading={loading} />
      {tournament && username && (
        <>
          <Text style={styles.text}>{WINNER_TEXT}</Text>
          <QrDisplay value={encodeQrPayload(buildQrPayload(username, tournament.name, 'WIN'))} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  text: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
});
