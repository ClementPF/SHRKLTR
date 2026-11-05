import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { CenteredLoading, EmptyState, ListFooter, SectionTitle } from '@/components/list-parts';
import { RankRow } from '@/components/rank-row';
import {
  historyItems,
  openUserDetail,
  renderListItem,
  type ListItem,
} from '@/features/feed/list-items';
import { flattenPages } from '@/features/users/queries';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { rankStats } from '@/lib/tournaments';
import { isPlaceholder } from '@/lib/users';
import { Colors, Palette, Spacing } from '@/theme';

import { useTournamentGames, useTournamentLeaderboard } from './queries';

export const NO_GAMES_TEXT = "No Games have been played for this tournament, let's change that.";
export const TOURNAMENT_LOAD_FAILED_TEXT = "Couldn't load this tournament.";

export interface TournamentScreenProps {
  name: string;
  /** Username of the signed-in user, used to orient the rivalry of an expanded game row. */
  viewer?: string;
}

export function TournamentScreen({ name, viewer }: TournamentScreenProps) {
  const leaderboard = useTournamentLeaderboard(name);
  const games = useTournamentGames(name);
  const [refreshing, setRefreshing] = useState(false);
  useErrorAlert(leaderboard.error, 'the ranking');
  useErrorAlert(games.error, 'the tournament history');

  if (leaderboard.isPending || games.isPending) return <CenteredLoading />;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([leaderboard.refetch(), games.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  if (leaderboard.isError && games.isError) {
    return (
      <EmptyState
        title={TOURNAMENT_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void onRefresh()}
      />
    );
  }

  const ranked = rankStats(leaderboard.data ?? []);
  const history = flattenPages(games.data);
  if (ranked.length === 0 && history.length === 0) {
    return (
      <EmptyState
        title={NO_GAMES_TEXT}
        actionTitle="Add a game"
        onAction={() => router.navigate('/add-game')}
      />
    );
  }

  const rankItems: ListItem[] = ranked.map(({ position, stats }) => ({
    kind: 'node',
    key: `rank-${stats.id}`,
    node: (
      <RankRow
        position={position}
        name={stats.user.username}
        score={stats.score}
        unclaimed={isPlaceholder(stats.user)}
        onPress={() => openUserDetail(stats.user.username, name)}
      />
    ),
  }));

  const sections = [
    { title: 'RANKING', data: rankItems },
    { title: 'HISTORY', data: historyItems(history) },
  ].filter((s) => s.data.length > 0);

  return (
    <View style={Palette.screen}>
      <SectionList
        testID="tournament-list"
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => renderListItem(item, viewer)}
        renderSectionHeader={({ section }) => <SectionTitle title={section.title} />}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={({ section }: { section: { title: string } }) => (
          <View style={section.title === 'RANKING' ? styles.rankSeparator : styles.separator} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.text}
          />
        }
        onEndReached={() => {
          if (games.hasNextPage && !games.isFetchingNextPage) void games.fetchNextPage();
        }}
        onEndReachedThreshold={1.5}
        ListFooterComponent={
          <ListFooter loading={games.isFetchingNextPage} endReached={!games.hasNextPage} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.sm },
  separator: { height: Spacing.sm },
  rankSeparator: { height: 1 },
});
