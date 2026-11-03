import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useHealth } from '@/features/health/use-health';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export function HealthStatus() {
  const { data, error, isPending } = useHealth();

  if (isPending) {
    return (
      <View style={styles.card} testID="health-status">
        <ActivityIndicator color={Colors.accent} />
        <Text style={Typography.bodySecondary}>Checking backend…</Text>
      </View>
    );
  }

  const healthy = !error && data.status === 'ok';
  const label = error
    ? `Backend unreachable: ${error.message}`
    : `Backend: ${data.status} (database ${data.database})`;

  return (
    <View style={styles.card} testID="health-status">
      <View style={[styles.dot, { backgroundColor: healthy ? Colors.success : Colors.error }]} />
      <Text style={Typography.body}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...Palette.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
