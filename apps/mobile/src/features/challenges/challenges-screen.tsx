import { useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { Challenge } from '@/api/types';
import { Button } from '@/components/button';
import { CenteredLoading, EmptyState, SectionTitle } from '@/components/list-parts';
import { flattenPages } from '@/features/users/queries';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { StatusBadge } from './challenge-parts';
import { challengeSummary, rivalOf, STATUS_LABELS } from './format';
import {
  openChallenge,
  openChallengeComposer,
  useChallenges,
  type ChallengeFilter,
} from './queries';

export const NO_ACTIVE_CHALLENGES_TEXT =
  'No open challenges.\nChallenge a rival from their profile, or start one here.';
export const NO_PAST_CHALLENGES_TEXT =
  'No past challenges yet.\nDeclined, completed and expired challenges end up here.';
export const CHALLENGES_LOAD_FAILED_TEXT = "Couldn't load your challenges.";

const FILTERS: { key: ChallengeFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'past', label: 'Past' },
];

/** Active challenges grouped by what the viewer has to do; past ones in a single section. */
export function challengeSections(
  challenges: readonly Challenge[],
  filter: ChallengeFilter,
  viewerId: string | undefined,
): { title: string; data: Challenge[] }[] {
  if (filter === 'past') return [{ title: 'PAST', data: [...challenges] }];
  const pending = challenges.filter((c) => c.status === 'PENDING');
  return [
    { title: 'WAITING FOR YOU', data: pending.filter((c) => c.opponent.id === viewerId) },
    { title: 'SENT', data: pending.filter((c) => c.opponent.id !== viewerId) },
    { title: 'ACCEPTED', data: challenges.filter((c) => c.status === 'ACCEPTED') },
  ].filter((s) => s.data.length > 0);
}

function ChallengeRow({
  challenge,
  viewerId,
  now,
}: {
  challenge: Challenge;
  viewerId: string | undefined;
  now: Date;
}) {
  const rival = rivalOf(challenge, viewerId).username;
  const summary = challengeSummary(challenge, viewerId, now);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open challenge with ${rival} in ${challenge.tournament.displayName}, ${STATUS_LABELS[challenge.status]}. ${summary}`}
      testID={`challenge-row-${challenge.id}`}
      onPress={() => openChallenge(challenge.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.names}>
        <Text style={styles.title} numberOfLines={1}>
          {challenge.challenger.id === viewerId ? `You vs ${rival}` : `${rival} vs you`}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          {challenge.tournament.displayName}
        </Text>
        <Text style={styles.summary} numberOfLines={2}>
          {summary}
        </Text>
      </View>
      <StatusBadge status={challenge.status} testID={`challenge-row-${challenge.id}-status`} />
    </Pressable>
  );
}

function FilterTabs({
  value,
  onChange,
}: {
  value: ChallengeFilter;
  onChange(filter: ChallengeFilter): void;
}) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {FILTERS.map(({ key, label }) => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={`${label} challenges`}
            accessibilityState={{ selected }}
            onPress={() => onChange(key)}
            testID={`challenge-filter-${key}`}
            style={[styles.tab, selected && styles.tabSelected]}
          >
            <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The signed-in player's challenges, sent and received, active or past. */
export function ChallengesScreen({ viewerId }: { viewerId: string | undefined }) {
  const [filter, setFilter] = useState<ChallengeFilter>('active');
  return (
    <View style={Palette.screen}>
      <View style={styles.header}>
        <FilterTabs value={filter} onChange={setFilter} />
        <Button title="New challenge" onPress={() => openChallengeComposer()} />
      </View>
      <ChallengeList key={filter} filter={filter} viewerId={viewerId} />
    </View>
  );
}

function ChallengeList({
  filter,
  viewerId,
}: {
  filter: ChallengeFilter;
  viewerId: string | undefined;
}) {
  const challenges = useChallenges(filter);
  const [refreshing, setRefreshing] = useState(false);

  if (challenges.isPending) return <CenteredLoading />;
  if (challenges.isError) {
    return (
      <EmptyState
        title={CHALLENGES_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void challenges.refetch()}
      />
    );
  }
  const rows = flattenPages(challenges.data);
  if (rows.length === 0) {
    return filter === 'active' ? (
      <EmptyState
        title={NO_ACTIVE_CHALLENGES_TEXT}
        actionTitle="Challenge someone"
        onAction={() => openChallengeComposer()}
      />
    ) : (
      <EmptyState title={NO_PAST_CHALLENGES_TEXT} />
    );
  }

  const now = new Date();
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await challenges.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SectionList
      testID={`challenges-list-${filter}`}
      sections={challengeSections(rows, filter, viewerId)}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ChallengeRow challenge={item} viewerId={viewerId} now={now} />}
      renderSectionHeader={({ section }) => <SectionTitle title={section.title} />}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={Colors.text}
        />
      }
      onEndReached={() => {
        if (challenges.hasNextPage && !challenges.isFetchingNextPage) {
          void challenges.fetchNextPage();
        }
      }}
      onEndReachedThreshold={1}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    padding: Spacing.sm,
  },
  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  tab: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  tabSelected: { backgroundColor: Colors.accent },
  tabText: { ...Typography.body, color: Colors.textSecondary },
  tabTextSelected: { color: Colors.text, fontWeight: '700' },
  content: { padding: Spacing.sm },
  row: {
    ...Palette.card,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pressed: { opacity: 0.8 },
  names: { flex: 1, gap: 2 },
  title: { ...Typography.body, fontSize: 18 },
  caption: { ...Typography.caption },
  summary: { ...Typography.bodySecondary, fontSize: 14 },
  separator: { height: Spacing.sm },
});
