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

import { AddPlayers } from './add-players';
import { useGameFormTournament, useSubmitGame } from './queries';
import { useGameFormStore } from './store';
import { GameFormTournamentHeader } from './tournament-header';

export const CONFIRM_TITLE = 'All Good ?';
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
}

export interface ScannerScreenProps {
  username: string | undefined;
  /** Signed-in account id; links issued for players added by name are kept for it. */
  userId?: string;
}

export function ScannerScreen({ username, userId }: ScannerScreenProps) {
  const { tournament, loading } = useGameFormTournament(username);
  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <GameFormTournamentHeader tournament={tournament} loading={loading} />
      {tournament && username && (
        <ScannerBody username={username} userId={userId} tournament={tournament} />
      )}
    </ScrollView>
  );
}

function ScannerBody({
  username,
  userId,
  tournament,
}: {
  username: string;
  userId: string | undefined;
  tournament: Tournament;
}) {
  const [mode, setMode] = useState<'scan' | 'show'>('scan');
  const [confirming, setConfirming] = useState(false);
  const outcomes = useGameFormStore((s) => s.outcomes);
  const resetOutcomes = useGameFormStore((s) => s.resetOutcomes);
  const submit = useSubmitGame();
  const blocker = submissionBlocker(outcomes);

  const confirm = () => {
    submit.mutate(
      { tournamentName: tournament.name, outcomes },
      {
        onSuccess: (game) => {
          setConfirming(false);
          resetOutcomes();
          router.replace({ pathname: '/game-form/result', params: { id: game.id } });
        },
        onError: (err) => {
          setConfirming(false);
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
          <QrScanner onScanned={handleScan} />
          {SHOW_MANUAL_CODE_ENTRY && <ManualCodeEntry onSubmit={handleScan} />}
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
      {mode === 'scan' && <AddPlayers ownerId={userId} />}
      <OutcomeColumns
        testID="scanned-outcomes"
        winners={members(outcomes, 'WIN')}
        losers={members(outcomes, 'LOSS')}
      />
      {blocker && <Text style={styles.caption}>{blocker}</Text>}
      <Button
        title="All good"
        testID="scanner-all-good"
        disabled={!!blocker}
        loading={submit.isPending}
        onPress={() => setConfirming(true)}
      />
      <ConfirmDialog
        visible={confirming}
        title={CONFIRM_TITLE}
        message={CONFIRM_MESSAGE}
        confirmTitle="Submit"
        loading={submit.isPending}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
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
