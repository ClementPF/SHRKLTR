import { router } from 'expo-router';
import { useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';

import type { Tournament } from '@/api/types';
import { CenteredLoading, EmptyState, SectionTitle } from '@/components/list-parts';
import { SearchBar } from '@/components/search-bar';
import { TournamentRow } from '@/components/tournament-row';
import { useTournaments } from '@/features/tournaments/queries';
import { NO_TOURNAMENTS_TEXT } from '@/features/tournaments/tournaments-screen';
import { useUserTournaments } from '@/features/users/queries';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { filterTournaments } from '@/lib/tournaments';
import { Palette, Spacing } from '@/theme';

import { useGameFormStore } from './store';

export function TournamentPickerScreen({ username }: { username: string | undefined }) {
  const [term, setTerm] = useState('');
  const recent = useUserTournaments(username);
  const all = useTournaments();
  const selectTournament = useGameFormStore((s) => s.selectTournament);
  useErrorAlert(recent.error, 'your recent tournaments');
  useErrorAlert(all.error, 'tournaments');

  if (recent.isPending && all.isPending) return <CenteredLoading />;

  const sections = [
    { title: 'RECENT TOURNAMENTS', data: filterTournaments(recent.data ?? [], term) },
    { title: 'ALL TOURNAMENTS', data: filterTournaments(all.data ?? [], term) },
  ].filter((s) => s.data.length > 0);

  const pick = (tournament: Tournament) => {
    selectTournament(tournament);
    if (router.canGoBack()) router.back();
    else router.replace('/add-game');
  };

  return (
    <View style={Palette.screen}>
      <View style={styles.search}>
        <SearchBar value={term} onChangeText={setTerm} />
      </View>
      <SectionList
        testID="tournament-picker-list"
        sections={sections}
        keyExtractor={(t, index) => `${t.id}-${index}`}
        renderItem={({ item }) => <TournamentRow tournament={item} onPress={() => pick(item)} />}
        renderSectionHeader={({ section }) => <SectionTitle title={section.title} />}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          <EmptyState
            title={NO_TOURNAMENTS_TEXT}
            actionTitle="Create a tournament"
            onAction={() => router.push('/new-tournament')}
          />
        }
        contentContainerStyle={styles.content}
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
