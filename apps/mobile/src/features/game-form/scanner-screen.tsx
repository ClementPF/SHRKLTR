import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { APP_ENV } from '@/api/config';
import type { Tournament } from '@/api/types';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { showAlert } from '@/components/dropdown-alert';
import { OutcomeColumns } from '@/components/outcome-columns';
import { QrDisplay } from '@/components/qr-display';
import { QrScanner } from '@/components/qr-scanner';
import { buildQrPayload, encodeQrPayload, submissionBlocker, type ScannedOutcome } from '@/lib/qr';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { useGameFormTournament, useSubmitGame } from './queries';
import { useGameFormStore } from './store';
import { GameFormTournamentHeader } from './tournament-header';

export const CONFIRM_TITLE = 'Confirm this game?';
export const CONFIRM_MESSAGE =
  "Make sure everything is right. Games can't be deleted or edited once submitted.";

/** Non-production builds accept a pasted QR payload, so the flow is testable without a camera. */
export const SHOW_MANUAL_CODE_ENTRY = APP_ENV !== 'production';

function ManualCodeEntry({ onSubmit }: { onSubmit(raw: string): void }) {
  const [code, setCode] = useState('');
  return (
    <View style={styles.manual} testID="manual-code-entry">
      <Text style={styles.caption}>DEV: paste a QR code payload</Text>
      <TextInput
        testID="manual-code-input"
        accessibilityLabel="QR code payload"
        value={code}
        onChangeText={setCode}
        placeholder='{"username":…}'
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <Button
        title="Add code"
        variant="secondary"
        testID="manual-code-submit"
        disabled={!code.trim()}
        onPress={() => {
          onSubmit(code.trim());
          setCode('');
        }}
      />
    </View>
  );
}

const members = (outcomes: readonly ScannedOutcome[], result: ScannedOutcome['result']) =>
  outcomes.filter((o) => o.result === result).map(({ username }) => ({ username }));

function handleScan(raw: string) {
  const result = useGameFormStore.getState().scan(raw);
  if (!result) return;
  if (result.status === 'added') {
    const role = result.added.result === 'WIN' ? 'winner' : 'loser';
    showAlert('success', 'Scanned', `${result.added.username} added as ${role}.`);
  } else if (result.status === 'invalid' || result.status === 'wrong-tournament') {
    showAlert('error', 'Error', result.error);
  }
  return result;
}

export function ScannerScreen({ username }: { username: string | undefined }) {
  const { tournament, loading } = useGameFormTournament(username);
  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <GameFormTournamentHeader tournament={tournament} loading={loading} />
      {tournament && username && <ScannerBody username={username} tournament={tournament} />}
    </ScrollView>
  );
}

function ScannerBody({ username, tournament }: { username: string; tournament: Tournament }) {
  const [mode, setMode] = useState<'scan' | 'show'>('scan');
  const [confirmation, setConfirmation] = useState<{
    tournament: Tournament;
    outcomes: ScannedOutcome[];
  } | null>(null);
  const outcomes = useGameFormStore((s) => s.outcomes);
  const resetOutcomes = useGameFormStore((s) => s.resetOutcomes);
  const submit = useSubmitGame();
  const blocker = submissionBlocker(outcomes);

  const review = () => {
    if (!blocker) setConfirmation({ tournament, outcomes });
  };

  const scan = (raw: string) => {
    if (confirmation) return;
    const result = handleScan(raw);
    if (result?.status === 'added' && !submissionBlocker(result.outcomes)) {
      setConfirmation({ tournament, outcomes: result.outcomes });
    }
  };

  const confirm = () => {
    if (!confirmation || submit.isPending) return;
    submit.mutate(
      { tournamentName: confirmation.tournament.name, outcomes: confirmation.outcomes },
      {
        onSuccess: (game) => {
          setConfirmation(null);
          resetOutcomes();
          router.replace({ pathname: '/game-form/result', params: { id: game.id } });
        },
        onError: (err) => {
          setConfirmation(null);
          showAlert('error', 'Error', `Failed to submit the game: ${err.message}`);
        },
      },
    );
  };

  return (
    <>
      {mode === 'scan' ? (
        <>
          <Button
            title="Get Scanned"
            variant="secondary"
            testID="scanner-get-scanned"
            onPress={() => setMode('show')}
          />
          {!confirmation && <QrScanner onScanned={scan} />}
          {SHOW_MANUAL_CODE_ENTRY && <ManualCodeEntry onSubmit={scan} />}
        </>
      ) : (
        <>
          <Button
            title="Scan"
            variant="secondary"
            testID="scanner-scan"
            onPress={() => setMode('scan')}
          />
          <Text style={styles.text}>Get scanned by your team mate</Text>
          <QrDisplay value={encodeQrPayload(buildQrPayload(username, tournament.name, 'LOSS'))} />
        </>
      )}
      <OutcomeColumns
        testID="scanned-outcomes"
        winners={members(outcomes, 'WIN')}
        losers={members(outcomes, 'LOSS')}
      />
      {blocker && <Text style={styles.caption}>{blocker}</Text>}
      <Button
        title="Review game"
        testID="scanner-review-game"
        disabled={!!blocker}
        loading={submit.isPending}
        onPress={review}
      />
      <ConfirmDialog
        visible={!!confirmation}
        title={CONFIRM_TITLE}
        message={CONFIRM_MESSAGE}
        confirmTitle="Confirm game"
        loading={submit.isPending}
        onConfirm={confirm}
        onCancel={() => setConfirmation(null)}
      >
        {confirmation && (
          <View style={styles.summary} testID="game-confirmation-summary">
            <Text style={styles.caption}>TOURNAMENT</Text>
            <Text style={styles.text}>{confirmation.tournament.displayName}</Text>
            <Text style={styles.text}>Winners</Text>
            {members(confirmation.outcomes, 'WIN').map(({ username }) => (
              <Text key={username} style={styles.text}>
                {username}
              </Text>
            ))}
            <Text style={styles.text}>Losers</Text>
            {members(confirmation.outcomes, 'LOSS').map(({ username }) => (
              <Text key={username} style={styles.text}>
                {username}
              </Text>
            ))}
          </View>
        )}
      </ConfirmDialog>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  summary: { gap: Spacing.sm },
  text: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
  caption: { ...Typography.caption, textAlign: 'center' },
  manual: { gap: Spacing.sm },
  input: {
    ...Typography.body,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
});
