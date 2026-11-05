import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AchievementUnlock } from '@/api/types';
import { fromNow } from '@/lib/format';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { badgeIcon } from './badges';
import { openAchievements } from './queries';

/** A feed entry for one of your own recent badge unlocks. */
export function UnlockRow({ unlock }: { unlock: AchievementUnlock }) {
  const { achievement, user } = unlock;
  const when = fromNow(unlock.unlockedAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Badge unlocked: ${achievement.title}. ${when}`}
      testID={`recent-unlock-${achievement.code}`}
      onPress={() => openAchievements(user.username)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Text style={styles.emoji}>{badgeIcon(achievement.code)}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.caption}>BADGE UNLOCKED · {when}</Text>
        <Text style={styles.title}>{achievement.title}</Text>
        <Text style={styles.description}>{achievement.description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  pressed: { opacity: 0.8 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  emoji: { fontSize: 22 },
  text: { flex: 1, gap: 2 },
  caption: { ...Typography.caption, letterSpacing: 1 },
  title: { ...Typography.body, fontWeight: '700' },
  description: { ...Typography.bodySecondary, fontSize: 14 },
});
