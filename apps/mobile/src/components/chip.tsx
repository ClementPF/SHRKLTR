import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export interface ChipProps {
  label: string;
  /** Second line under the label, e.g. a tournament's sport. */
  caption?: string;
  selected: boolean;
  onPress(): void;
  /** `radio` inside a radiogroup, `button` for a toggle-like pick. */
  role?: 'button' | 'radio';
  accessibilityLabel?: string;
  testID?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

/** One selectable option. Selected chips are filled, so the choice reads at a glance. */
export function Chip({
  label,
  caption,
  selected,
  onPress,
  role = 'button',
  accessibilityLabel,
  testID,
  disabled = false,
  style,
}: ChipProps) {
  const a11y = role === 'radio' ? { 'aria-checked': selected } : { 'aria-selected': selected };
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? (caption ? `${label}, ${caption}` : label)}
      {...a11y}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        {label}
      </Text>
      {caption ? (
        <Text style={[styles.caption, selected && styles.captionSelected]} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  testID?: string;
}

/** Mutually exclusive views of one screen, shown as tabs. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
}) {
  return (
    <View style={styles.segments} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            aria-selected={selected}
            testID={option.testID}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text style={[styles.segmentText, selected && styles.labelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceRaised,
    gap: 2,
  },
  selected: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  label: { ...Typography.body, fontSize: 14 },
  labelSelected: { color: Colors.text, fontWeight: '700' },
  caption: { ...Typography.caption },
  captionSelected: { color: Colors.text },
  segments: {
    flexDirection: 'row',
    padding: Spacing.xs,
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
  },
  segmentText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
