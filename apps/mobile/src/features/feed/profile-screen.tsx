import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import type { Stats } from '@/api/types';
import { showAlert } from '@/components/dropdown-alert';
import { CenteredLoading, EmptyState, ListFooter, SectionTitle } from '@/components/list-parts';
import { UserTile } from '@/components/user-tile';
import {
  DETAIL_PAGE_SIZE,
  challengeFailureMessage,
  flattenPages,
  useChallenge,
  useTournamentStats,
  useUserGames,
  useUserRivalries,
  useUserStats,
} from '@/features/users/queries';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { splitRivalries, toDonutSlices } from '@/lib/rivalries';
import { Colors, Palette, Spacing } from '@/theme';

import { historyItems, renderListItem, statsItems, type ListItem } from './list-items';

export interface ProfileScreenProps {
  username: string;
  /** Narrows the screen to one tournament and adds the SHARKS / FISHES charts. */
  tournamentName?: string;
  /** Username of the signed-in user; their own profile cannot be challenged. */
  viewer?: string;
}

function useProfileStats(username: string, tournamentName: string | undefined) {
  const all = useUserStats(tournamentName ? undefined : username);
  const one = useTournamentStats(username, tournamentName);
  if (tournamentName) {
    const data: Stats[] | undefined =
      one.data === undefined ? undefined : one.data ? [one.data] : [];
    return { data, isPending: one.isPending, error: one.error, refetch: one.refetch };
  }
  return { data: all.data, isPending: all.isPending, error: all.error, refetch: all.refetch };
}

export function ProfileScreen({ username, tournamentName, viewer }: ProfileScreenProps) {
  const stats = useProfileStats(username, tournamentName);
  const rivalries = useUserRivalries(username, tournamentName);
  const games = useUserGames(username, { tournamentName, pageSize: DETAIL_PAGE_SIZE });
  const challenge = useChallenge(username);
  const [challenged, setChallenged] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useErrorAlert(stats.error, 'stats');
  useErrorAlert(tournamentName ? rivalries.error : null, 'rivalries');
  useErrorAlert(games.error, 'games');

  if (stats.isPending || games.isPending) return <CenteredLoading />;

  const statsList = stats.data ?? [];
  const wins = statsList.reduce((n, s) => n + s.winCount, 0);
  const gameCount = statsList.reduce((n, s) => n + s.gameCount, 0);
  const canChallenge = !!viewer && viewer !== username;

  const onChallenge = () => {
    challenge.mutate(undefined, {
      onSuccess: () => setChallenged(true),
      onError: () => {
        setChallenged(false);
        showAlert('error', 'Error', challengeFailureMessage(username));
      },
    });
  };

  const { sharks, fishes } = tournamentName
    ? splitRivalries(rivalries.data ?? [])
    : { sharks: [], fishes: [] };

  const allSections: { title: string | null; data: ListItem[] }[] = [
    {
      title: null,
      data: [
        {
          kind: 'node',
          key: 'user-tile',
          node: (
            <UserTile
              username={username}
              wins={wins}
              games={gameCount}
              challenged={challenged}
              challenging={challenge.isPending}
              onChallenge={canChallenge ? onChallenge : undefined}
            />
          ),
        },
      ],
    },
    { title: 'STATS', data: statsItems(statsList, tournamentName ? undefined : 'user') },
    {
      title: 'SHARKS',
      data: sharks.length
        ? [{ kind: 'donut', key: 'sharks-chart', slices: toDonutSlices(sharks) }]
        : [],
    },
    {
      title: 'FISHES',
      data: fishes.length
        ? [{ kind: 'donut', key: 'fishes-chart', slices: toDonutSlices(fishes) }]
        : [],
    },
    { title: 'GAME HISTORY', data: historyItems(flattenPages(games.data)) },
  ];
  const sections = allSections.filter((s) => s.data.length > 0);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([stats.refetch(), rivalries.refetch(), games.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={Palette.screen}>
      <SectionList
        testID="profile-list"
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => renderListItem(item, viewer)}
        renderSectionHeader={({ section }) =>
          section.title ? <SectionTitle title={section.title} /> : null
        }
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
          statsList.length === 0 && !games.data?.pages[0]?.length ? (
            <EmptyState title="Haven't played yet, create a tournament or enter a game." />
          ) : (
            <ListFooter loading={games.isFetchingNextPage} endReached={!games.hasNextPage} />
          )
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
