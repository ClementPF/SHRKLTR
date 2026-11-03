import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Spacing, Typography } from '@/theme';

export function HeaderButton({ title, onPress }: { title: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  pressed: { opacity: 0.6 },
  label: { ...Typography.body, fontWeight: '700', color: Colors.accent },
});
