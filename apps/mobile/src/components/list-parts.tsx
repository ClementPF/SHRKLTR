import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export function SectionTitle({ title }: { title: string }) {
  return <Text style={Palette.sectionHeader}>{title}</Text>;
}

export function ListFooter({ loading, endReached }: { loading: boolean; endReached: boolean }) {
  if (loading) return <ActivityIndicator style={styles.footer} color={Colors.text} />;
  if (endReached) return <Text style={[Palette.sectionHeader, styles.footer]}>No more games.</Text>;
  return null;
}

export function CenteredLoading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={Colors.accent} />
    </View>
  );
}

export function EmptyState({
  title,
  actionTitle,
  onAction,
  children,
}: {
  title: string;
  actionTitle?: string;
  onAction?(): void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.center} testID="empty-state">
      <Text style={styles.emptyText}>{title}</Text>
      {actionTitle && onAction && <Button title={actionTitle} onPress={onAction} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingVertical: Spacing.lg },
  center: {
    ...Palette.screen,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  emptyText: { ...Typography.body, textAlign: 'center', lineHeight: 24 },
});
