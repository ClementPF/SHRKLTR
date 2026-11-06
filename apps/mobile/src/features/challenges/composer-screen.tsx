import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/errors';
import type { Challenge, Tournament, User } from '@/api/types';
import { Button } from '@/components/button';
import { useUser, useUsers } from '@/features/users/queries';
import { gameDate } from '@/lib/format';
import { displayName, isPlaceholder } from '@/lib/users';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import {
  DEADLINE_PRESETS,
  DEFAULT_DEADLINE_MS,
  DEFAULT_PRESET_KEY,
  deadlineAtFor,
  deadlineProblem,
  parseDuration,
  type DeadlineUnit,
} from './deadline';
import { useChallengeableTournaments, useCreateChallenge } from './queries';

export const MAX_OPPONENT_MATCHES = 5;
export const SELF_CHALLENGE_TEXT = "You can't challenge yourself.";
export const NOT_REGISTERED_TEXT =
  "Only registered players can be challenged. This player hasn't claimed their profile yet.";
const CUSTOM_KEY = 'custom';

export function noSharedTournamentText(opponent: string): string {
  return `You and ${opponent} don't share a running tournament yet. Open tournaments and tournaments of groups you are both in can host a challenge.`;
}

/** What to tell the challenger when the API refuses the challenge. */
export function createChallengeErrorText(error: Error, opponent: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ACTIVE_CHALLENGE_EXISTS':
        return `You and ${opponent} already have an active challenge in this tournament. Finish it or let it expire first.`;
      case 'PLAYER_NOT_GROUP_MEMBER':
        return `${opponent} isn't a member of this tournament's group.`;
      case 'OPPONENT_NOT_REGISTERED':
        return NOT_REGISTERED_TEXT;
      case 'SELF_CHALLENGE':
        return SELF_CHALLENGE_TEXT;
      case 'INVALID_DEADLINE':
        return `${error.message.replace(/\.$/, '')}.`;
      case 'USER_NOT_FOUND':
      case 'TOURNAMENT_NOT_FOUND':
        return "That player or tournament isn't available to you anymore.";
    }
  }
  return `Couldn't send the challenge: ${error.message}`;
}

interface ChoiceProps {
  label: string;
  caption?: string;
  selected: boolean;
  onPress(): void;
  testID?: string;
}

function Choice({ label, caption, selected, onPress, testID }: ChoiceProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={caption ? `${label}, ${caption}` : label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.choiceText} numberOfLines={1}>
        {label}
      </Text>
      {caption ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

function matches(user: User, query: string): boolean {
  const q = query.toLowerCase();
  return user.username.toLowerCase().includes(q) || displayName(user).toLowerCase().includes(q);
}

function OpponentSearch({ viewer, onPick }: { viewer: string; onPick(username: string): void }) {
  const [query, setQuery] = useState('');
  const search = query.trim();
  const users = useUsers(search.length > 0);
  const found = (users.data ?? [])
    .filter((u) => u.username !== viewer && !isPlaceholder(u) && matches(u, search))
    .slice(0, MAX_OPPONENT_MATCHES);
  return (
    <View style={styles.block}>
      <TextInput
        testID="opponent-search-input"
        accessibilityLabel="Find an opponent"
        value={query}
        onChangeText={setQuery}
        placeholder="Find a player by name or username"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      {search.length > 0 && users.isPending && <Text style={styles.caption}>Searching…</Text>}
      {search.length > 0 && users.isError && (
        <Text style={styles.caption}>Couldn't load players: {users.error.message}</Text>
      )}
      {search.length > 0 && users.isSuccess && found.length === 0 && (
        <Text style={styles.caption}>No registered player matches “{search}”.</Text>
      )}
      {found.map((user) => (
        <Pressable
          key={user.id}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${user.username}`}
          testID={`opponent-option-${user.username}`}
          onPress={() => onPick(user.username)}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
        >
          <Text style={styles.choiceText} numberOfLines={1}>
            {displayName(user)}
          </Text>
          <Text style={styles.caption}>@{user.username}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SelectedOpponent({
  username,
  viewer,
  onChange,
}: {
  username: string;
  viewer: string;
  onChange(): void;
}) {
  const user = useUser(username);
  const problem =
    username === viewer
      ? SELF_CHALLENGE_TEXT
      : isPlaceholder(user.data)
        ? NOT_REGISTERED_TEXT
        : null;
  return (
    <View style={styles.block}>
      <View style={styles.selected} testID="selected-opponent">
        <View style={styles.names}>
          <Text style={styles.choiceText} numberOfLines={1}>
            {user.data ? displayName(user.data) : username}
          </Text>
          <Text style={styles.caption}>@{username}</Text>
        </View>
        <Button title="Change opponent" variant="secondary" onPress={onChange} />
      </View>
      {problem && (
        <Text style={styles.error} accessibilityRole="alert" testID="opponent-error">
          {problem}
        </Text>
      )}
    </View>
  );
}

function tournamentCaption(t: Tournament): string {
  return t.group ? `${t.sport.name} · ${t.group.name} group` : `${t.sport.name} · open`;
}

function TournamentPicker({
  opponent,
  selected,
  onSelect,
}: {
  opponent: string | null;
  selected: string | null;
  onSelect(name: string): void;
}) {
  const tournaments = useChallengeableTournaments(opponent ?? undefined);
  if (!opponent) {
    return (
      <Text style={styles.hint}>Choose an opponent to see the tournaments you both play in.</Text>
    );
  }
  if (tournaments.isPending) return <Text style={styles.hint}>Loading tournaments…</Text>;
  if (tournaments.error) {
    return (
      <View style={styles.block}>
        <Text style={styles.error}>Couldn't load tournaments: {tournaments.error.message}</Text>
        <Button title="Retry" variant="secondary" onPress={tournaments.refetch} />
      </View>
    );
  }
  const list = tournaments.data ?? [];
  if (list.length === 0) {
    return (
      <Text style={styles.hint} testID="no-shared-tournament">
        {noSharedTournamentText(opponent)}
      </Text>
    );
  }
  return (
    <View style={styles.block} accessibilityRole="radiogroup" accessibilityLabel="Tournament">
      {list.map((t) => (
        <Choice
          key={t.id}
          label={t.displayName}
          caption={tournamentCaption(t)}
          selected={t.name === selected}
          onPress={() => onSelect(t.name)}
          testID={`tournament-option-${t.name}`}
        />
      ))}
    </View>
  );
}

export interface ChallengeComposerProps {
  /** Username of the signed-in player. */
  viewer: string;
  initialOpponent?: string;
  initialTournament?: string;
  onCreated(challenge: Challenge): void;
}

/** Challenge someone: an opponent, a tournament you both can play in and a deadline. */
export function ChallengeComposer({
  viewer,
  initialOpponent,
  initialTournament,
  onCreated,
}: ChallengeComposerProps) {
  const [opponent, setOpponent] = useState<string | null>(initialOpponent ?? null);
  const [tournament, setTournament] = useState<string | null>(initialTournament ?? null);
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET_KEY);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<DeadlineUnit>('days');
  const [attempted, setAttempted] = useState(false);
  const create = useCreateChallenge();
  const opponentProfile = useUser(opponent ?? undefined);
  const shared = useChallengeableTournaments(opponent ?? undefined);

  const custom = presetKey === CUSTOM_KEY;
  const durationMs = custom
    ? parseDuration(amount, unit)
    : (DEADLINE_PRESETS.find((p) => p.key === presetKey)?.durationMs ?? DEFAULT_DEADLINE_MS);
  const deadlineError = deadlineProblem(durationMs);
  const showDeadlineError = !!deadlineError && (attempted || (custom && amount.trim() !== ''));
  // A tournament chosen earlier (or passed in) only counts while it is shared with this opponent.
  const chosen = shared.data?.find((t) => t.name === tournament) ?? null;
  const opponentInvalid = !opponent || opponent === viewer || isPlaceholder(opponentProfile.data);

  const edit = <T,>(setter: (value: T) => void) => {
    return (value: T) => {
      setter(value);
      create.reset();
    };
  };

  const submit = () => {
    setAttempted(true);
    if (create.isPending || !opponent || opponentInvalid || !chosen) return;
    if (deadlineError || durationMs === null) return;
    create.mutate(
      {
        tournamentName: chosen.name,
        opponentUsername: opponent,
        deadlineAt: deadlineAtFor(durationMs, new Date()),
      },
      { onSuccess: (challenge) => onCreated(challenge) },
    );
  };

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="challenge-composer"
    >
      <Text style={styles.intro}>
        Your opponent can accept or decline. Once accepted, your next game against each other in the
        tournament before the deadline decides the challenge. Unplayed challenges simply expire.
      </Text>

      <Text style={styles.label}>Opponent</Text>
      {opponent ? (
        <SelectedOpponent
          username={opponent}
          viewer={viewer}
          onChange={() => {
            setOpponent(null);
            create.reset();
          }}
        />
      ) : (
        <OpponentSearch viewer={viewer} onPick={edit(setOpponent)} />
      )}

      <Text style={styles.label}>Tournament</Text>
      <TournamentPicker opponent={opponent} selected={tournament} onSelect={edit(setTournament)} />
      {attempted && opponent && !chosen && !shared.isPending && !!shared.data?.length && (
        <Text style={styles.error} accessibilityRole="alert" testID="tournament-error">
          Choose a tournament.
        </Text>
      )}

      <Text style={styles.label}>Deadline</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Deadline">
        {DEADLINE_PRESETS.map((preset) => (
          <Choice
            key={preset.key}
            label={preset.label}
            selected={presetKey === preset.key}
            onPress={() => edit(setPresetKey)(preset.key)}
            testID={`deadline-${preset.key}`}
          />
        ))}
        <Choice
          label="Custom"
          selected={custom}
          onPress={() => edit(setPresetKey)(CUSTOM_KEY)}
          testID="deadline-custom"
        />
      </View>
      {custom && (
        <View style={styles.customRow}>
          <TextInput
            testID="deadline-amount-input"
            accessibilityLabel={`Deadline in ${unit}`}
            value={amount}
            onChangeText={edit(setAmount)}
            keyboardType="number-pad"
            placeholder="Amount"
            placeholderTextColor={Colors.textMuted}
            style={[styles.input, styles.amount]}
          />
          {(['hours', 'days'] as const).map((value) => (
            <Choice
              key={value}
              label={value === 'hours' ? 'Hours' : 'Days'}
              selected={unit === value}
              onPress={() => edit(setUnit)(value)}
              testID={`deadline-unit-${value}`}
            />
          ))}
        </View>
      )}
      {showDeadlineError ? (
        <Text style={styles.error} accessibilityRole="alert" testID="deadline-error">
          {deadlineError}
        </Text>
      ) : durationMs !== null && !deadlineError ? (
        <Text style={styles.hint} testID="deadline-preview">
          Due {gameDate(new Date(Date.now() + durationMs).toISOString())}
        </Text>
      ) : null}

      {create.isError && opponent && (
        <Text style={styles.error} accessibilityRole="alert" testID="create-challenge-error">
          {createChallengeErrorText(create.error, opponent)}
        </Text>
      )}
      <Button
        title="Send challenge"
        testID="send-challenge"
        loading={create.isPending}
        disabled={opponentInvalid || (!!opponent && shared.data?.length === 0)}
        onPress={submit}
        style={styles.submit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.sm },
  intro: { ...Typography.bodySecondary },
  label: { ...Typography.body, fontWeight: '700', marginTop: Spacing.md },
  block: { gap: Spacing.sm },
  hint: { ...Typography.bodySecondary, fontSize: 14 },
  caption: { ...Typography.caption },
  error: { ...Typography.body, color: Colors.warning },
  input: {
    ...Typography.body,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
  },
  selected: { ...Palette.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  names: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceRaised,
    gap: 2,
  },
  choiceSelected: { borderColor: Colors.accent, borderWidth: 2 },
  choiceText: { ...Typography.body },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  amount: { flex: 1 },
  pressed: { opacity: 0.8 },
  submit: { marginTop: Spacing.lg },
});
