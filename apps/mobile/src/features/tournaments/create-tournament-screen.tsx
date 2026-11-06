import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Group, Tournament } from '@/api/types';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { showAlert } from '@/components/dropdown-alert';
import { canManage, groupKeys, useGroups } from '@/features/groups/queries';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { useCreateTournament, useSports } from './queries';

export function createdMessage(displayName: string): string {
  return `${displayName} has been created. Good luck!`;
}

export const SPORTS_LOAD_FAILED_TEXT = "Couldn't load sport suggestions.";

export interface CreateTournamentScreenProps {
  onCreated(tournament: Tournament): void;
  /** Preselects a group, e.g. when starting from that group's page. */
  initialGroupId?: string;
}

export const OPEN_TOURNAMENT_LABEL = 'Open to everyone';

/** Only owners and admins may create tournaments inside a group. */
export function managedGroups(groups: readonly Group[] | undefined): Group[] {
  return (groups ?? []).filter((g) => canManage(g.role));
}

function GroupPicker({
  groups,
  selected,
  onSelect,
}: {
  groups: Group[];
  selected: string | null;
  onSelect(groupId: string | null): void;
}) {
  const options: { id: string | null; label: string; a11y: string }[] = [
    { id: null, label: OPEN_TOURNAMENT_LABEL, a11y: OPEN_TOURNAMENT_LABEL },
    ...groups.map((g) => ({ id: g.id, label: g.name, a11y: `Group ${g.name}` })),
  ];
  return (
    <View style={styles.chips} testID="tournament-group-picker">
      {options.map((o) => (
        <Chip
          key={o.id ?? 'open'}
          label={o.label}
          accessibilityLabel={o.a11y}
          selected={o.id === selected}
          onPress={() => onSelect(o.id)}
        />
      ))}
    </View>
  );
}

export function CreateTournamentScreen({ onCreated, initialGroupId }: CreateTournamentScreenProps) {
  const [title, setTitle] = useState('');
  const [sport, setSport] = useState('');
  const [groupId, setGroupId] = useState<string | null>(initialGroupId ?? null);
  const sports = useSports();
  useErrorAlert(sports.error, 'sports');
  const groups = useGroups();
  const managed = managedGroups(groups.data);
  const queryClient = useQueryClient();
  const create = useCreateTournament();
  const displayName = title.trim();
  const sportName = sport.trim();
  const selectedGroup = managed.find((g) => g.id === groupId) ?? null;
  const sportInput = useRef<ComponentRef<typeof TextInput>>(null);

  const submit = () => {
    if (!displayName || !sportName || create.isPending) return;
    create.mutate(groupId ? { displayName, sportName, groupId } : { displayName, sportName }, {
      onSuccess: (tournament) => {
        if (groupId) void queryClient.invalidateQueries({ queryKey: groupKeys.group(groupId) });
        showAlert('success', 'Tournament created', createdMessage(tournament.displayName));
        onCreated(tournament);
      },
      onError: (err) => showAlert('error', 'Error', `Failed to create tournament: ${err.message}`),
    });
  };

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={styles.label}>Tournament title</Text>
      <TextInput
        testID="tournament-title-input"
        accessibilityLabel="Tournament title"
        value={title}
        onChangeText={setTitle}
        placeholder="Office Babyfoot"
        placeholderTextColor={Colors.textMuted}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => sportInput.current?.focus()}
        style={Palette.input}
      />
      <Text style={styles.label}>Sport</Text>
      <TextInput
        ref={sportInput}
        testID="tournament-sport-input"
        accessibilityLabel="Sport"
        value={sport}
        onChangeText={setSport}
        placeholder="babyfoot"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={submit}
        style={Palette.input}
      />
      {!!sports.data?.length && (
        <View style={styles.chips}>
          {sports.data.map((s) => (
            <Chip
              key={s.id}
              label={s.name}
              accessibilityLabel={`Sport ${s.name}`}
              selected={s.name === sportName}
              onPress={() => setSport(s.name)}
            />
          ))}
        </View>
      )}
      {sports.isError && !sports.data?.length && (
        <View testID="sports-load-error" style={styles.sportsError}>
          <Text style={styles.sportsErrorText}>{SPORTS_LOAD_FAILED_TEXT}</Text>
          <Chip
            label={sports.isFetching ? 'Retrying…' : 'Retry'}
            accessibilityLabel="Retry loading sports"
            selected={false}
            disabled={sports.isFetching}
            onPress={() => void sports.refetch()}
          />
        </View>
      )}
      {(managed.length > 0 || groupId) && (
        <>
          <Text style={styles.label}>Group</Text>
          <GroupPicker groups={managed} selected={groupId} onSelect={setGroupId} />
          <Text style={styles.hint} testID="tournament-group-hint">
            {selectedGroup
              ? `Only members of ${selectedGroup.name} will see this tournament.`
              : groupId
                ? groups.isPending
                  ? 'Checking the selected group…'
                  : 'Only owners and admins of a group can create tournaments in it.'
                : 'Everyone on Sharkulator can see this tournament.'}
          </Text>
        </>
      )}
      <Button
        title="Create tournament"
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  sportsError: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sportsErrorText: { ...Typography.caption, color: Colors.textMuted, flexShrink: 1 },
  hint: { ...Typography.caption },
  submit: { marginTop: Spacing.md },
});
