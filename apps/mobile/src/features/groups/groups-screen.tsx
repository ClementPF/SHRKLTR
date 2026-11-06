import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { Group } from '@/api/types';
import { Button } from '@/components/button';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { RoleBadge } from './group-parts';
import { openGroup, useGroups } from './queries';

export const NO_GROUPS_TEXT =
  "You're not in any group yet. Create one for your club, office or bar, or join one with an invite code.";
export const GROUPS_LOAD_FAILED_TEXT = "Couldn't load your groups.";

export function openCreateGroup() {
  router.push('/groups/new');
}

export function openJoinByCode() {
  router.push('/join');
}

function memberCount(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`;
}

function GroupRow({ group }: { group: Group }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open group ${group.name}`}
      testID={`group-row-${group.id}`}
      onPress={() => openGroup(group.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.names}>
        <Text style={styles.title} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.caption}>{memberCount(group.memberCount)}</Text>
      </View>
      <RoleBadge role={group.role} />
    </Pressable>
  );
}

/** My groups: every group the signed-in account belongs to, plus create and join entries. */
export function GroupsScreen() {
  const groups = useGroups();
  const [refreshing, setRefreshing] = useState(false);

  if (groups.isPending) return <CenteredLoading />;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await groups.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const data = groups.data ?? [];
  return (
    <View style={Palette.screen}>
      <FlatList
        testID="groups-list"
        data={data}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => <GroupRow group={item} />}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          data.length > 0 ? (
            <View style={styles.actions}>
              <Button title="Create a group" onPress={openCreateGroup} style={styles.action} />
              <Button
                title="Join with a code"
                variant="secondary"
                onPress={openJoinByCode}
                style={styles.action}
              />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          groups.isError ? (
            <EmptyState
              title={GROUPS_LOAD_FAILED_TEXT}
              actionTitle="Retry"
              onAction={() => void groups.refetch()}
            />
          ) : (
            <EmptyState
              title={NO_GROUPS_TEXT}
              actionTitle="Create a group"
              onAction={openCreateGroup}
            >
              <Button title="Join with a code" variant="secondary" onPress={openJoinByCode} />
            </EmptyState>
          )
        }
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.text}
          />
        }
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.sm, flexGrow: 1 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  action: { flex: 1 },
  row: {
    ...Palette.card,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pressed: { opacity: 0.8 },
  names: { flex: 1, gap: Spacing.xs },
  title: { ...Typography.body, fontSize: 18 },
  caption: { ...Typography.caption },
  separator: { height: Spacing.sm },
});
