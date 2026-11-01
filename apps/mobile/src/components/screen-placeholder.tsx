import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette, Spacing, Typography } from '@/theme';

interface ScreenPlaceholderProps {
  title: string;
  children?: ReactNode;
}

export function ScreenPlaceholder({ title, children }: ScreenPlaceholderProps) {
  return (
    <View style={styles.container}>
      <Text style={Typography.title}>{title}</Text>
      <Text style={Typography.bodySecondary}>Coming soon.</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...Palette.screen,
    padding: Spacing.md,
    gap: Spacing.md,
  },
});
