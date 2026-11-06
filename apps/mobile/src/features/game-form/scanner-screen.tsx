import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

import { ADD_WITHOUT_QR_ENABLED, AddPlayers } from './add-players';
import { useGameFormTournament, useSubmitGame } from './queries';
import { useGameFormStore } from './store';
import { GameFormTournamentHeader } from './tournament-header';

export const SUBMITTER_LABEL = "I'll submit";
export const TEAMMATE_LABEL = 'Teammate submits';
export const SCAN_TEXT = "Scan each winner's QR code. In a team game, scan your teammates too.";
export const TEAMMATE_TEXT =
  'Show this code to the teammate who is submitting. Once they scan it, you are in the game and there is nothing else to do here.';

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

export interface ScannerScreenProps {
  username: string | undefined;
  /** Signed-in account id; links issued for players added by name are kept for it. */
  userId?: string;
}

export function ScannerScreen({ username, userId }: ScannerScreenProps) {
  const { tournament, loading } = useGameFormTournament(username);
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Spacing.md + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <GameFormTournamentHeader tournament={tournament} loading={loading} />
      {tournament && username && (
        <ScannerBody username={username} userId={userId} tournament={tournament} />
      )}
    </ScrollView>
  );
}

type Role = 'submitter' | 'teammate';

/** In a team game only one loser submits; the other losers just show their code to them. */
function RoleChoice({ role, onChange }: { role: Role; onChange(role: Role): void }) {
  const options = [
    { value: 'submitter', label: SUBMITTER_LABEL, testID: 'scanner-scan' },
    { value: 'teammate', label: TEAMMATE_LABEL, testID: 'scanner-get-scanned' },
  ] as const;
  return (
    <View style={styles.roleBlock}>
      <Text style={styles.caption}>Team game (2v2, 3v3…)? Only one loser submits it.</Text>
      <View style={styles.segments} accessibilityRole="tablist">
        {options.map(({ value, label, testID }) => {
          const selected = value === role;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={label}
              aria-selected={selected}
              testID={testID}
              onPress={() => onChange(value)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  const [role, setRole] = useState<Role>('submitter');
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

  if (role === 'teammate') {
    return (
      <>
        <RoleChoice role={role} onChange={setRole} />
        <Text style={styles.text} testID="scanner-teammate-text">
          {TEAMMATE_TEXT}
        </Text>
        <QrDisplay value={encodeQrPayload(buildQrPayload(username, tournament.name, 'LOSS'))} />
      </>
    );
  }

  return (
    <>
      <RoleChoice role={role} onChange={setRole} />
      <Text style={styles.text}>{SCAN_TEXT}</Text>
      {!confirmation && <QrScanner onScanned={scan} />}
      {SHOW_MANUAL_CODE_ENTRY && <ManualCodeEntry onSubmit={scan} />}
      {ADD_WITHOUT_QR_ENABLED && <AddPlayers ownerId={userId} />}
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
            <Text style={styles.tournament}>{confirmation.tournament.displayName}</Text>
            <Text style={styles.sport}>{confirmation.tournament.sport.name}</Text>
            <OutcomeColumns
              testID="game-confirmation-outcomes"
              winners={members(confirmation.outcomes, 'WIN')}
              losers={members(confirmation.outcomes, 'LOSS')}
            />
          </View>
        )}
      </ConfirmDialog>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  summary: { ...Palette.card, gap: Spacing.sm },
  tournament: { ...Typography.title, textAlign: 'center' },
  sport: { ...Typography.bodySecondary, textAlign: 'center', textTransform: 'capitalize' },
  text: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
  caption: { ...Typography.caption, textAlign: 'center' },
  manual: { gap: Spacing.sm },
  roleBlock: { gap: Spacing.sm },
  segments: {
    flexDirection: 'row',
    padding: Spacing.xs,
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
  },
  segmentSelected: { backgroundColor: Colors.accent },
  segmentText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  segmentTextSelected: { color: Colors.text, fontWeight: '700' },
  input: {
    ...Typography.body,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
});
