import { SymbolView, type SymbolViewProps } from 'expo-symbols';
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

/** Icon-only header action; `label` is what screen readers and tests find it by. */
export function HeaderIconButton({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: SymbolViewProps['name'];
  onPress(): void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <SymbolView name={icon} tintColor={Colors.text} size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  icon: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  pressed: { opacity: 0.6 },
  label: { ...Typography.body, fontWeight: '700', color: Colors.accent },
});
