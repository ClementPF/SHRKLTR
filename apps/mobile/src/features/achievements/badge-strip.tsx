import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { UserAchievement } from '@/api/types';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { badgeIcon, badgeLabel } from './badges';
import { openAchievements, useUserAchievements } from './queries';

export const BADGES_LOAD_FAILED_TEXT = "Couldn't load badges.";

function BadgeIcon({ achievement }: { achievement: UserAchievement }) {
  const { unlocked } = achievement;
  return (
    <View
      style={[styles.icon, unlocked ? styles.iconUnlocked : styles.iconLocked]}
      testID={`badge-strip-${achievement.code}`}
      accessibilityLabel={badgeLabel(achievement.title, unlocked)}
    >
      <Text style={[styles.emoji, !unlocked && styles.emojiLocked]}>
        {badgeIcon(achievement.code)}
      </Text>
    </View>
  );
}

/** Unlocked badges first (newest first), then the locked rest of the catalog. */
function stripOrder(achievements: readonly UserAchievement[]): UserAchievement[] {
  const unlocked = achievements
    .filter((a) => a.unlocked)
    .sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''));
  return [...unlocked, ...achievements.filter((a) => !a.unlocked)];
}

/** Profile summary of a user's badges; tapping it opens their full achievements page. */
export function BadgeStrip({ username }: { username: string }) {
  const achievements = useUserAchievements(username);
  const data = achievements.data;
  const unlockedCount = data?.filter((a) => a.unlocked).length ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        data ? `Achievements, ${unlockedCount} of ${data.length} unlocked` : 'Achievements'
      }
      testID="badge-strip"
      onPress={() => openAchievements(username)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>ACHIEVEMENTS</Text>
        <View style={styles.headerEnd}>
          {data && <Text style={styles.count}>{`${unlockedCount}/${data.length}`}</Text>}
          <Text style={styles.more}>View all ›</Text>
        </View>
      </View>
      {achievements.isPending ? (
        <ActivityIndicator color={Colors.text} />
      ) : achievements.isError ? (
        <Text style={styles.message}>{BADGES_LOAD_FAILED_TEXT}</Text>
      ) : (
        <View style={styles.icons}>
          {stripOrder(achievements.data).map((achievement) => (
            <BadgeIcon key={achievement.code} achievement={achievement} />
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, gap: Spacing.sm },
  pressed: { opacity: 0.8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...Typography.caption, color: Colors.text, fontWeight: '700', letterSpacing: 1 },
  headerEnd: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  count: { ...Typography.caption, color: Colors.text, fontWeight: '700' },
  more: { ...Typography.caption, color: Colors.textSecondary },
  message: { ...Typography.bodySecondary, fontSize: 14 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconUnlocked: { backgroundColor: Colors.surfaceRaised, borderColor: Colors.accent },
  iconLocked: { backgroundColor: Colors.background, borderColor: Colors.border, opacity: 0.35 },
  emoji: { fontSize: 18 },
  emojiLocked: { opacity: 0.6 },
});
