import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { useSession } from '@/auth/session';
import { CenteredLoading, EmptyState, ListFooter, SectionTitle } from '@/components/list-parts';
import { useRecentUnlocks } from '@/features/achievements/queries';
import { UnlockRow } from '@/features/achievements/unlock-row';
import { FEED_PAGE_SIZE, flattenPages, useUserGames, useUserStats } from '@/features/users/queries';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { Colors, Palette, Spacing } from '@/theme';

import { historyItems, renderListItem, statsItems, type ListItem } from './list-items';

export const EMPTY_FEED_TEXT =
  'Hey, welcome to the SHARKULATOR,\nYour feed is empty so far,\ngo play a game, treat yourself,\nyou deserve it Champ.';

export function FeedScreen() {
  const username = useSession().user?.username;
  const stats = useUserStats(username);
  const games = useUserGames(username, { pageSize: FEED_PAGE_SIZE });
  const unlocks = useRecentUnlocks(username);
  const [refreshing, setRefreshing] = useState(false);
  useErrorAlert(stats.error, 'your stats');
  useErrorAlert(games.error, 'your games');
  useErrorAlert(unlocks.error, 'your badges');

  if (stats.isPending || games.isPending) return <CenteredLoading />;

  const history = flattenPages(games.data);
  const statsList = stats.data ?? [];
  const recentUnlocks = unlocks.data ?? [];
  if (history.length === 0 && statsList.length === 0 && recentUnlocks.length === 0) {
    return (
      <EmptyState
        title={EMPTY_FEED_TEXT}
        actionTitle="Find a tournament"
        onAction={() => router.navigate('/tournaments')}
      />
    );
  }

  const sections: { title: string; data: ListItem[] }[] = [
    {
      title: 'RECENT BADGES',
      data: recentUnlocks.map((unlock): ListItem => ({
        kind: 'node',
        key: `unlock-${unlock.achievement.code}`,
        node: <UnlockRow unlock={unlock} />,
      })),
    },
    { title: 'YOUR TOURNAMENTS', data: statsItems(statsList, 'user') },
    { title: 'YOUR HISTORY', data: historyItems(history) },
  ].filter((s) => s.data.length > 0);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([stats.refetch(), games.refetch(), unlocks.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={Palette.screen}>
      <SectionList
        testID="feed-list"
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => renderListItem(item, username)}
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

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.sm },
  separator: { height: Spacing.sm },
});
