import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Tournament } from '@/api/types';
import { Button } from '@/components/button';
import { showAlert } from '@/components/dropdown-alert';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { useCreateTournament, useSports } from './queries';

export function createdMessage(displayName: string): string {
  return `${displayName} has been successfully created, good luck !`;
}

export const SPORTS_LOAD_FAILED_TEXT = "Couldn't load sport suggestions.";

export interface CreateTournamentScreenProps {
  onCreated(tournament: Tournament): void;
}

export function CreateTournamentScreen({ onCreated }: CreateTournamentScreenProps) {
  const [title, setTitle] = useState('');
  const [sport, setSport] = useState('');
  const sports = useSports();
  useErrorAlert(sports.error, 'sports');
  const create = useCreateTournament();
  const displayName = title.trim();
  const sportName = sport.trim();

  const submit = () => {
    create.mutate(
      { displayName, sportName },
      {
        onSuccess: (tournament) => {
          showAlert('success', 'Great !', createdMessage(tournament.displayName));
          onCreated(tournament);
        },
        onError: (err) =>
          showAlert('error', 'Error', `Failed to create tournament: ${err.message}`),
      },
    );
  };

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Tournament Title</Text>
      <TextInput
        testID="tournament-title-input"
        accessibilityLabel="Tournament Title"
        value={title}
        onChangeText={setTitle}
        placeholder="Office Babyfoot"
        placeholderTextColor={Colors.textMuted}
        style={styles.input}
      />
      <Text style={styles.label}>Sport</Text>
      <TextInput
        testID="tournament-sport-input"
        accessibilityLabel="Sport"
        value={sport}
        onChangeText={setSport}
        placeholder="babyfoot"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        style={styles.input}
      />
      {!!sports.data?.length && (
        <View style={styles.chips}>
          {sports.data.map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={`Sport ${s.name}`}
              onPress={() => setSport(s.name)}
              style={[styles.chip, s.name === sportName && styles.chipSelected]}
            >
              <Text style={styles.chipText}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {sports.isError && !sports.data?.length && (
        <View testID="sports-load-error" style={styles.sportsError}>
          <Text style={styles.sportsErrorText}>{SPORTS_LOAD_FAILED_TEXT}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading sports"
            onPress={() => void sports.refetch()}
            disabled={sports.isFetching}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{sports.isFetching ? 'Retrying…' : 'Retry'}</Text>
          </Pressable>
        </View>
      )}
      <Button
        title="Create Tournament"
        testID="create-tournament-submit"
        onPress={submit}
        loading={create.isPending}
        disabled={!displayName || !sportName}
        style={styles.submit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.sm },
  label: { ...Typography.body, fontWeight: '700', marginTop: Spacing.sm },
  input: {
    ...Typography.body,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceRaised,
  },
  chipSelected: { borderColor: Colors.accent },
  chipText: { ...Typography.caption, color: Colors.text },
  sportsError: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sportsErrorText: { ...Typography.caption, color: Colors.textMuted, flexShrink: 1 },
  submit: { marginTop: Spacing.md },
});
