import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { User } from '@/api/types';
import { Button } from '@/components/button';
import { showAlert } from '@/components/dropdown-alert';
import { UnclaimedBadge } from '@/components/unclaimed-badge';
import { useGroupMembers, useGroupPlayers } from '@/features/groups/queries';
import { useCreatePlaceholder } from '@/features/invites/queries';
import { flattenPages, useUsers } from '@/features/users/queries';
import type { QrResult } from '@/lib/qr';
import { displayName, isPlaceholder } from '@/lib/users';
import { Colors, Radius, Spacing, Typography } from '@/theme';

import { useGameFormStore } from './store';

export const MAX_PLAYER_MATCHES = 5;

const roleOf = (side: QrResult) => (side === 'WIN' ? 'winner' : 'loser');

export function placeholderAddedMessage(username: string, side: QrResult): string {
  return `${username} added as ${roleOf(side)}. Their claim link is in Settings › Invited players.`;
}

export function placeholderFailedMessage(name: string, reason: string): string {
  return `Couldn't add "${name}" (${reason.replace(/\.$/, '')}). Your game draft is unchanged.`;
}

function addToDraft(username: string, side: QrResult): boolean {
  const status = useGameFormStore.getState().addPlayer({ username, result: side });
  if (status === 'duplicate') {
    showAlert('info', 'Already added', `${username} is already in this game.`);
    return false;
  }
  return true;
}

function SideChoice({ side, onChange }: { side: QrResult; onChange(side: QrResult): void }) {
  return (
    <View style={styles.chips}>
      {(['WIN', 'LOSS'] as const).map((value) => {
        const selected = value === side;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Add as ${roleOf(value)}`}
            accessibilityState={{ selected }}
            onPress={() => onChange(value)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={styles.chipText}>{value === 'WIN' ? 'Winner' : 'Loser'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function matches(user: User, query: string): boolean {
  const q = query.toLowerCase();
  return user.username.toLowerCase().includes(q) || displayName(user).toLowerCase().includes(q);
}

/**
 * Who can play in the draft's tournament: everyone for an open tournament; for a group's
 * tournament only its members and its unclaimed players.
 */
function useCandidates(groupId: string | undefined, enabled: boolean) {
  const users = useUsers(enabled && !groupId);
  const members = useGroupMembers(groupId ?? '', enabled && !!groupId);
  const players = useGroupPlayers(groupId ?? '', enabled && !!groupId);
  const { hasNextPage, isFetchingNextPage, isError: membersFailed, fetchNextPage } = members;
  // Groups have no member cap, so search every page rather than only the first one.
  const loadMore = enabled && !!groupId && hasNextPage && !isFetchingNextPage && !membersFailed;
  useEffect(() => {
    if (loadMore) void fetchNextPage();
  }, [loadMore, fetchNextPage]);
  if (!groupId) return users;
  const error = members.error ?? players.error;
  const allMembers = members.isSuccess && !hasNextPage;
  return {
    data:
      allMembers && players.isSuccess
        ? [...flattenPages(members.data).map((m) => m.user), ...players.data.map((p) => p.user)]
        : undefined,
    isPending: !error && (!allMembers || players.isPending),
    isSuccess: allMembers && players.isSuccess,
    isError: !!error,
    error,
  };
}

function PlayerPicker({ side, groupId }: { side: QrResult; groupId: string | undefined }) {
  const [query, setQuery] = useState('');
  const outcomes = useGameFormStore((s) => s.outcomes);
  const search = query.trim();
  const users = useCandidates(groupId, search.length > 0);
  const taken = new Set(outcomes.map((o) => o.username));
  const found = (users.data ?? [])
    .filter((u) => !taken.has(u.username) && matches(u, search))
    .slice(0, MAX_PLAYER_MATCHES);

  const pick = (user: User) => {
    if (addToDraft(user.username, side)) {
      showAlert('success', 'Player added', `${user.username} added as ${roleOf(side)}.`);
      setQuery('');
    }
  };

  return (
    <View style={styles.block}>
      <TextInput
        testID="player-search-input"
        accessibilityLabel="Find a player"
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
        <Text style={styles.caption}>Couldn't load players: {users.error?.message}</Text>
      )}
      {search.length > 0 && users.isSuccess && found.length === 0 && (
        <Text style={styles.caption}>
          {groupId
            ? `No member or unclaimed player of this group matches “${search}”.`
            : `No player matches “${search}”.`}
        </Text>
      )}
      {found.map((user) => (
        <Pressable
          key={user.id}
          accessibilityRole="button"
          accessibilityLabel={`Add ${user.username}`}
          testID={`player-option-${user.username}`}
          onPress={() => pick(user)}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
        >
          <Text style={styles.optionText} numberOfLines={1}>
            {user.username}
          </Text>
          {isPlaceholder(user) && (
            <UnclaimedBadge testID={`player-option-${user.username}-unclaimed`} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

function AddByName({
  side,
  ownerId,
  groupId,
}: {
  side: QrResult;
  ownerId: string | undefined;
  groupId: string | undefined;
}) {
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const create = useCreatePlaceholder(ownerId, groupId);
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed || create.isPending) return;
    const submittedSide = side;
    setFailure(null);
    create.mutate(trimmed, {
      onSuccess: (issued) => {
        setName('');
        if (addToDraft(issued.user.username, submittedSide)) {
          showAlert(
            'success',
            'Player added',
            placeholderAddedMessage(issued.user.username, submittedSide),
          );
        }
      },
      onError: (err) => setFailure(placeholderFailedMessage(trimmed, err.message)),
    });
  };

  return (
    <View style={styles.block}>
      <TextInput
        testID="placeholder-name-input"
        accessibilityLabel="New player name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          setFailure(null);
        }}
        editable={!create.isPending}
        placeholder="Name of someone without an account"
        placeholderTextColor={Colors.textMuted}
        maxLength={100}
        style={styles.input}
        onSubmitEditing={submit}
      />
      <Button
        title="Add player by name"
        variant="secondary"
        testID="placeholder-add"
        disabled={!trimmed}
        loading={create.isPending}
        onPress={submit}
      />
      {create.isPending && (
        <Text style={styles.caption} testID="placeholder-pending">
          Adding {trimmed}…
        </Text>
      )}
      {failure && (
        <View style={styles.failure} accessibilityRole="alert" testID="placeholder-error">
          <Text style={styles.failureText}>{failure}</Text>
          <Button title="Retry" variant="secondary" onPress={submit} />
        </View>
      )}
    </View>
  );
}

/** Adds players to the draft without scanning: an existing player, or a new one by name. */
export function AddPlayers({ ownerId }: { ownerId: string | undefined }) {
  const [side, setSide] = useState<QrResult>('WIN');
  const group = useGameFormStore((s) => s.tournament?.group ?? null);
  const groupId = group?.id;
  return (
    <View style={styles.container} testID="add-players">
      <Text style={styles.title}>NO QR CODE?</Text>
      {group && (
        <Text style={styles.caption} testID="add-players-group">
          {group.name} tournament: pick a member or unclaimed player. New players added by name join
          the group's unclaimed players.
        </Text>
      )}
      <SideChoice side={side} onChange={setSide} />
      <PlayerPicker key={`picker-${groupId ?? 'open'}`} side={side} groupId={groupId} />
      <AddByName
        key={`name-${groupId ?? 'open'}`}
        side={side}
        ownerId={ownerId}
        groupId={groupId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
  },
  title: { ...Typography.caption, letterSpacing: 2, textAlign: 'center' },
  block: { gap: Spacing.sm },
  caption: { ...Typography.caption, textAlign: 'center' },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceRaised,
  },
  chipSelected: { borderColor: Colors.accent },
  chipText: { ...Typography.body },
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
  optionText: { ...Typography.body, flex: 1 },
  pressed: { opacity: 0.8 },
  failure: {
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  failureText: { ...Typography.body },
});
