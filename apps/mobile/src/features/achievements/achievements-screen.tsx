import { useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { UserAchievement } from '@/api/types';
import { CenteredLoading, EmptyState, SectionTitle } from '@/components/list-parts';
import { openGame } from '@/features/games/queries';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { LOCKED_ICON, badgeIcon, badgeLabel, unlockDate } from './badges';
import { useUserAchievements } from './queries';

export const ACHIEVEMENTS_LOAD_FAILED_TEXT = "Couldn't load these achievements.";
export const NO_UNLOCKS_TEXT = 'No badges unlocked yet.';

function AchievementRow({ achievement }: { achievement: UserAchievement }) {
  const { unlocked, unlockedAt } = achievement;
  // The API nulls source games the viewer cannot see, so a present id is safe to link.
  const sourceGameId = achievement.source?.gameId;
  return (
    <View
      style={[styles.row, !unlocked && styles.locked]}
      testID={`achievement-${achievement.code}`}
      accessibilityLabel={badgeLabel(achievement.title, unlocked)}
    >
      <View style={[styles.icon, unlocked ? styles.iconUnlocked : styles.iconLocked]}>
        <Text style={styles.emoji}>{unlocked ? badgeIcon(achievement.code) : LOCKED_ICON}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{achievement.title}</Text>
        <Text style={styles.description}>{achievement.description}</Text>
        <View style={styles.statusLine}>
          <Text style={[styles.status, unlocked && styles.unlockedStatus]}>
            {unlocked && unlockedAt
              ? `Unlocked ${unlockDate(unlockedAt)}`
              : unlocked
                ? 'Unlocked'
                : 'Locked'}
          </Text>
          {unlocked && sourceGameId && (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="View game"
              hitSlop={8}
              onPress={() => openGame(sourceGameId)}
            >
              <Text style={styles.link}>View game ›</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

type Row = { kind: 'badge'; achievement: UserAchievement } | { kind: 'none' };

export function AchievementsScreen({ username }: { username: string | undefined }) {
  const achievements = useUserAchievements(username);
  const [refreshing, setRefreshing] = useState(false);

  if (achievements.isPending) return <CenteredLoading />;
  if (achievements.isError) {
    return (
      <EmptyState
        title={ACHIEVEMENTS_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void achievements.refetch()}
      />
    );
  }

  const unlocked = achievements.data
    .filter((a) => a.unlocked)
    .sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''));
  const locked = achievements.data.filter((a) => !a.unlocked);
  const toRows = (list: UserAchievement[]): Row[] =>
    list.map((achievement) => ({ kind: 'badge', achievement }));
  const sections: { title: string; data: Row[] }[] = [
    {
      title: `UNLOCKED (${unlocked.length})`,
      data: unlocked.length ? toRows(unlocked) : [{ kind: 'none' }],
    },
    ...(locked.length ? [{ title: `LOCKED (${locked.length})`, data: toRows(locked) }] : []),
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await achievements.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SectionList
      style={Palette.screen}
      testID="achievements-list"
      sections={sections}
      keyExtractor={(item) => (item.kind === 'badge' ? item.achievement.code : 'none')}
      contentContainerStyle={styles.content}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <Text style={styles.summary}>
          {username} · {unlocked.length}/{achievements.data.length} unlocked
        </Text>
      }
      renderSectionHeader={({ section }) => <SectionTitle title={section.title} />}
      renderItem={({ item }) =>
        item.kind === 'badge' ? (
          <AchievementRow achievement={item.achievement} />
        ) : (
          <Text style={styles.none}>{NO_UNLOCKS_TEXT}</Text>
        )
      }
      ItemSeparatorComponent={Separator}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={Colors.text}
        />
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md },
  separator: { height: Spacing.sm },
  summary: { ...Typography.bodySecondary, textAlign: 'center' },
  none: { ...Typography.bodySecondary, textAlign: 'center', paddingVertical: Spacing.sm },
  row: { ...Palette.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  locked: { opacity: 0.5 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconUnlocked: { backgroundColor: Colors.surfaceRaised, borderColor: Colors.accent },
  iconLocked: { backgroundColor: Colors.background, borderColor: Colors.border },
  emoji: { fontSize: 22 },
  text: { flex: 1, gap: Spacing.xs },
  title: { ...Typography.body, fontWeight: '700' },
  description: { ...Typography.bodySecondary, fontSize: 14 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  status: { ...Typography.caption },
  unlockedStatus: { color: Colors.success },
  link: { ...Typography.caption, color: Colors.text, fontWeight: '700' },
});
