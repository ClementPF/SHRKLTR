import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Group, GroupPlayer, Tournament } from '@/api/types';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { CenteredLoading, SectionTitle } from '@/components/list-parts';
import { RankRow } from '@/components/rank-row';
import { UnclaimedBadge } from '@/components/unclaimed-badge';
import { openUserDetail } from '@/features/feed/list-items';
import { useInvitedPlayers } from '@/features/invites/queries';
import { useTournamentLeaderboard } from '@/features/tournaments/queries';
import { openTournament } from '@/features/tournaments/tournaments-screen';
import { flattenPages, useUsers } from '@/features/users/queries';
import { rankStats } from '@/lib/tournaments';
import { displayName, isPlaceholder } from '@/lib/users';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { GroupLoadFailed, GroupNotFound, PersonRow, ROLE_LABELS, openProfile } from './group-parts';
import {
  canManage,
  useAddGroupPlayer,
  useGroupMembers,
  useGroupPlayers,
  useGroupTournaments,
} from './queries';
import { useGroupAccess } from './use-group-access';

export const NO_GROUP_TOURNAMENTS_TEXT = 'This group has no tournaments yet.';
export const NO_LEADERBOARD_TEXT = 'No games have been played in this tournament yet.';
export const NO_UNCLAIMED_TEXT =
  "No unclaimed players. Players added by name in this group's tournaments appear here until they claim their profile.";
export const MAX_ROSTER_MATCHES = 5;

export function openGroupMembers(id: string) {
  router.push({ pathname: '/groups/[id]/members', params: { id } });
}

export function openGroupInvite(id: string) {
  router.push({ pathname: '/groups/[id]/invite', params: { id } });
}

export function openNewGroupTournament(groupId: string) {
  router.push({ pathname: '/new-tournament', params: { groupId } });
}

function Leaderboard({ tournament }: { tournament: Tournament }) {
  const leaderboard = useTournamentLeaderboard(tournament.name);
  if (leaderboard.isPending) return <Text style={styles.caption}>Loading the leaderboard…</Text>;
  if (leaderboard.isError) {
    return (
      <Text style={styles.caption} accessibilityRole="alert">
        Couldn't load the leaderboard: {leaderboard.error.message}
      </Text>
    );
  }
  const ranked = rankStats(leaderboard.data);
  if (ranked.length === 0) return <Text style={styles.caption}>{NO_LEADERBOARD_TEXT}</Text>;
  return (
    <View style={styles.leaderboard} testID={`group-leaderboard-${tournament.name}`}>
      {ranked.map(({ position, stats }) => (
        <RankRow
          key={stats.id}
          position={position}
          name={stats.user.username}
          score={stats.score}
          unclaimed={isPlaceholder(stats.user)}
          onPress={() => openUserDetail(stats.user.username, tournament.name)}
        />
      ))}
    </View>
  );
}

function GroupTournaments({ group, tournaments }: { group: Group; tournaments: Tournament[] }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = tournaments.find((t) => t.name === selectedName) ?? tournaments[0];
  const manager = canManage(group.role);

  return (
    <View style={styles.section}>
      <SectionTitle title="TOURNAMENTS" />
      {tournaments.length === 0 && <Text style={styles.caption}>{NO_GROUP_TOURNAMENTS_TEXT}</Text>}
      {tournaments.length > 0 && (
        <View style={styles.chips}>
          {tournaments.map((t) => {
            const isSelected = t.name === selected?.name;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`Leaderboard of ${t.displayName}`}
                accessibilityState={{ selected: isSelected }}
                testID={`group-tournament-${t.name}`}
                onPress={() => setSelectedName(t.name)}
                style={[styles.chip, isSelected && styles.chipSelected]}
              >
                <Text style={styles.chipText}>{t.displayName}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {selected && (
        <View style={styles.block}>
          <Text style={styles.selectedTitle} testID="group-selected-tournament">
            {selected.displayName} · {selected.sport.name}
          </Text>
          <Leaderboard key={selected.name} tournament={selected} />
          <Button
            title={`Open ${selected.displayName}`}
            variant="secondary"
            onPress={() => openTournament(selected)}
          />
        </View>
      )}
      {manager && (
        <Button
          title="New tournament in this group"
          variant="secondary"
          onPress={() => openNewGroupTournament(group.id)}
        />
      )}
    </View>
  );
}

function AddRosterPlayer({
  groupId,
  roster,
  manager,
}: {
  groupId: string;
  roster: GroupPlayer[];
  manager: boolean;
}) {
  const { user: me } = useSession();
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const users = useUsers(manager && search.length > 0);
  // Members may only roster placeholders they created themselves, so they search their own list.
  const own = useInvitedPlayers(manager ? undefined : me?.id);
  const candidates = manager ? users : own;
  const add = useAddGroupPlayer(groupId);
  const rostered = new Set(roster.map((p) => p.user.id));
  const pool = manager ? (users.data ?? []) : (own.data ?? []).map((p) => p.user);
  const found = pool
    .filter(
      (u) =>
        isPlaceholder(u) &&
        !rostered.has(u.id) &&
        (u.username.toLowerCase().includes(search) ||
          displayName(u).toLowerCase().includes(search)),
    )
    .slice(0, MAX_ROSTER_MATCHES);

  return (
    <View style={styles.block}>
      <TextInput
        testID="roster-search-input"
        accessibilityLabel="Find an unclaimed player to add"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          add.reset();
        }}
        placeholder="Add an existing unclaimed player"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={Palette.input}
      />
      {search.length > 0 && candidates.isSuccess && found.length === 0 && (
        <Text style={styles.caption}>No unclaimed player matches “{query.trim()}”.</Text>
      )}
      {search.length > 0 &&
        found.map((user) => (
          <Pressable
            key={user.id}
            accessibilityRole="button"
            accessibilityLabel={`Add ${user.username} to the group`}
            testID={`roster-option-${user.username}`}
            disabled={add.isPending}
            onPress={() =>
              add.mutate(user.id, {
                onSuccess: () => setQuery(''),
              })
            }
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Text style={styles.optionText} numberOfLines={1}>
              {user.username}
            </Text>
            <UnclaimedBadge testID={`roster-option-${user.username}-unclaimed`} />
          </Pressable>
        ))}
      {add.isError && (
        <Text style={styles.error} accessibilityRole="alert" testID="roster-add-error">
          Couldn't add that player: {add.error.message}
        </Text>
      )}
    </View>
  );
}

export function GroupScreen({ id }: { id: string }) {
  const members = useGroupMembers(id);
  const tournaments = useGroupTournaments(id);
  const players = useGroupPlayers(id);
  const { group, missing } = useGroupAccess(id, members, tournaments, players);
  const [refreshing, setRefreshing] = useState(false);

  if (missing) return <GroupNotFound />;
  if (group.isPending) return <CenteredLoading />;
  if (!group.data) return <GroupLoadFailed onRetry={() => void group.refetch()} />;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        group.refetch(),
        members.refetch(),
        tournaments.refetch(),
        players.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const summary = group.data;
  const manager = canManage(summary.role);
  const memberList = flattenPages(members.data);
  const roster = players.data ?? [];

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="group-screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={Colors.text}
        />
      }
    >
      <View style={styles.card}>
        <Text style={styles.title} testID="group-name">
          {summary.name}
        </Text>
        <Text style={styles.caption} testID="group-my-role">
          {summary.memberCount} {summary.memberCount === 1 ? 'member' : 'members'} · You are{' '}
          {ROLE_LABELS[summary.role].toLowerCase()}
        </Text>
        <View style={styles.actions}>
          <Button
            title="Manage members"
            variant="secondary"
            onPress={() => openGroupMembers(id)}
            style={styles.action}
          />
          {manager && (
            <Button
              title="Invite people"
              variant="secondary"
              onPress={() => openGroupInvite(id)}
              style={styles.action}
            />
          )}
        </View>
      </View>

      {tournaments.isPending ? (
        <CenteredLoading />
      ) : tournaments.isError ? (
        <Text style={styles.error} accessibilityRole="alert">
          Couldn't load the tournaments: {tournaments.error.message}
        </Text>
      ) : (
        <GroupTournaments group={summary} tournaments={tournaments.data} />
      )}

      <View style={styles.section}>
        <SectionTitle title="MEMBERS" />
        {members.isError && (
          <Text style={styles.error} accessibilityRole="alert">
            Couldn't load the members: {members.error.message}
          </Text>
        )}
        {memberList.map((m) => (
          <PersonRow
            key={m.user.id}
            user={m.user}
            role={m.role}
            testID={`group-member-${m.user.username}`}
            onPress={() => openProfile(m.user.username)}
          />
        ))}
        {members.hasNextPage && (
          <Button
            title="Show more members"
            variant="secondary"
            loading={members.isFetchingNextPage}
            onPress={() => void members.fetchNextPage()}
          />
        )}
      </View>

      <View style={styles.section}>
        <SectionTitle title="UNCLAIMED PLAYERS" />
        {players.isError && (
          <Text style={styles.error} accessibilityRole="alert">
            Couldn't load the unclaimed players: {players.error.message}
          </Text>
        )}
        {players.isSuccess && roster.length === 0 && (
          <Text style={styles.caption}>{NO_UNCLAIMED_TEXT}</Text>
        )}
        {roster.map((p) => (
          <PersonRow
            key={p.user.id}
            user={p.user}
            unclaimed
            testID={`group-player-${p.user.username}`}
            onPress={() => openProfile(p.user.username)}
          />
        ))}
        {players.isSuccess && <AddRosterPlayer groupId={id} roster={roster} manager={manager} />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.lg },
  card: { ...Palette.card, gap: Spacing.sm },
  title: { ...Typography.title },
  caption: { ...Typography.caption },
  error: { ...Typography.body, color: Colors.warning },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: { flexGrow: 1 },
  section: { gap: Spacing.sm },
  block: { gap: Spacing.sm },
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
  chipText: { ...Typography.body },
  selectedTitle: { ...Typography.body, fontWeight: '700' },
  leaderboard: { gap: 1, borderRadius: Radius.sm, overflow: 'hidden' },
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
});
