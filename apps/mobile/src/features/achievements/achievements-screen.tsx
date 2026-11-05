import dayjs from 'dayjs';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { UserAchievement } from '@/api/types';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { useUserAchievements } from './queries';

export const ACHIEVEMENTS_LOAD_FAILED_TEXT = "Couldn't load these achievements.";

function AchievementRow({ achievement }: { achievement: UserAchievement }) {
  const { unlocked, unlockedAt } = achievement;
  return (
    <View
      style={[styles.row, !unlocked && styles.locked]}
      testID={`achievement-${achievement.code}`}
      accessibilityLabel={`${achievement.title}, ${unlocked ? 'unlocked' : 'locked'}`}
    >
      <Text style={styles.title}>{achievement.title}</Text>
      <Text style={styles.description}>{achievement.description}</Text>
      <Text style={[styles.status, unlocked && styles.unlockedStatus]}>
        {unlocked && unlockedAt
          ? `Unlocked ${dayjs(unlockedAt).format('MMM D, YYYY')}`
          : unlocked
            ? 'Unlocked'
            : 'Locked'}
      </Text>
    </View>
  );
}

export function AchievementsScreen({ username }: { username: string | undefined }) {
  const achievements = useUserAchievements(username);

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

  const unlockedCount = achievements.data.filter((a) => a.unlocked).length;
  return (
    <FlatList
      style={Palette.screen}
      testID="achievements-list"
      data={achievements.data}
      keyExtractor={(item) => item.code}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <Text style={styles.summary}>
          {username} · {unlockedCount}/{achievements.data.length} unlocked
        </Text>
      }
      renderItem={({ item }) => <AchievementRow achievement={item} />}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.sm },
  summary: { ...Typography.bodySecondary, textAlign: 'center', marginBottom: Spacing.sm },
  row: { ...Palette.card, gap: Spacing.xs },
  locked: { opacity: 0.5 },
  title: { ...Typography.body, fontWeight: '700' },
  description: { ...Typography.bodySecondary, fontSize: 14 },
  status: { ...Typography.caption },
  unlockedStatus: { color: Colors.success },
});
