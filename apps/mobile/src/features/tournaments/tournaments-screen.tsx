import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import type { Tournament } from '@/api/types';
import { CenteredLoading, EmptyState, SectionTitle } from '@/components/list-parts';
import { SearchBar } from '@/components/search-bar';
import { TournamentRow } from '@/components/tournament-row';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { filterTournaments } from '@/lib/tournaments';
import { Colors, Palette, Spacing } from '@/theme';

import { useTournaments } from './queries';

export const NO_TOURNAMENTS_TEXT =
  "Can't find what you're looking for? Why don't you create a new tournament and start preying on some fishes.";
export const TOURNAMENTS_LOAD_FAILED_TEXT = "Couldn't load the tournaments.";

export function openTournament(tournament: Pick<Tournament, 'name' | 'displayName'>) {
  router.push({
    pathname: '/tournament/[name]',
    params: { name: tournament.name, displayName: tournament.displayName },
  });
}

export function openCreateTournament() {
  router.push('/new-tournament');
}

export function TournamentsScreen() {
  const tournaments = useTournaments();
  const [term, setTerm] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useErrorAlert(tournaments.error, 'tournaments');

  if (tournaments.isPending) return <CenteredLoading />;

  const filtered = filterTournaments(tournaments.data ?? [], term);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await tournaments.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={Palette.screen}>
      <View style={styles.search}>
        <SearchBar value={term} onChangeText={setTerm} />
      </View>
      <FlatList
        testID="tournaments-list"
        data={filtered}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TournamentRow tournament={item} onPress={() => openTournament(item)} />
        )}
        ListHeaderComponent={
          filtered.length > 0 ? <SectionTitle title="ALL TOURNAMENTS" /> : undefined
        }
        ListEmptyComponent={
          tournaments.isError ? (
            <EmptyState
              title={TOURNAMENTS_LOAD_FAILED_TEXT}
              actionTitle="Retry"
              onAction={() => void tournaments.refetch()}
            />
          ) : (
            <EmptyState
              title={NO_TOURNAMENTS_TEXT}
              actionTitle="Create a tournament"
              onAction={openCreateTournament}
            />
          )
        }
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={Separator}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.text}
          />
        }
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: Spacing.sm, paddingTop: Spacing.sm },
  content: { padding: Spacing.sm, flexGrow: 1 },
  separator: { height: Spacing.sm },
});
