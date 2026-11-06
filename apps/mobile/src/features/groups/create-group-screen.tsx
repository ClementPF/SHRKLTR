import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import type { Group } from '@/api/types';
import { Button } from '@/components/button';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { GROUP_NAME_MAX, useCreateGroup } from './queries';

export const GROUP_NAME_REQUIRED_TEXT = 'Enter a name for the group.';
export const GROUP_NAME_TOO_LONG_TEXT = `Group names can be at most ${GROUP_NAME_MAX} characters.`;

/** The problem with a group name as the API will see it (trimmed), or null. */
export function groupNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return GROUP_NAME_REQUIRED_TEXT;
  if (trimmed.length > GROUP_NAME_MAX) return GROUP_NAME_TOO_LONG_TEXT;
  return null;
}

export function CreateGroupScreen({ onCreated }: { onCreated(group: Group): void }) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const create = useCreateGroup();
  const problem = groupNameProblem(name);
  const length = name.trim().length;

  const submit = () => {
    setTouched(true);
    if (problem || create.isPending) return;
    create.mutate(name.trim(), { onSuccess: onCreated });
  };

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>
        A group keeps its tournaments, games and standings private to its members. You will be its
        owner.
      </Text>
      <Text style={styles.label}>Group name</Text>
      <TextInput
        testID="group-name-input"
        accessibilityLabel="Group name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          setTouched(true);
          create.reset();
        }}
        placeholder="Office Pong Club"
        placeholderTextColor={Colors.textMuted}
        style={styles.input}
        onSubmitEditing={submit}
      />
      <Text
        style={[styles.counter, length > GROUP_NAME_MAX && styles.error]}
        testID="group-name-count"
      >
        {length}/{GROUP_NAME_MAX}
      </Text>
      {touched && problem && (
        <Text style={styles.error} accessibilityRole="alert" testID="group-name-error">
          {problem}
        </Text>
      )}
      {create.isError && (
        <Text style={styles.error} accessibilityRole="alert" testID="create-group-error">
          Couldn't create the group: {create.error.message}
        </Text>
      )}
      <Button
        title="Create group"
        testID="create-group-submit"
        loading={create.isPending}
        disabled={!!problem}
        onPress={submit}
        style={styles.submit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.sm },
  intro: { ...Typography.bodySecondary },
  label: { ...Typography.body, fontWeight: '700', marginTop: Spacing.sm },
  input: {
    ...Typography.body,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
  counter: { ...Typography.caption, textAlign: 'right' },
  error: { ...Typography.body, color: Colors.warning },
  submit: { marginTop: Spacing.md },
});
