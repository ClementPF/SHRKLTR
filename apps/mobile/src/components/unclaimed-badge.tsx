import { StyleSheet, Text } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export const UNCLAIMED_LABEL = 'UNCLAIMED';

/** Marks a placeholder player (added by name, profile not claimed yet). */
export function UnclaimedBadge({ testID = 'unclaimed-badge' }: { testID?: string }) {
  return (
    <Text style={styles.badge} testID={testID} accessibilityLabel="Unclaimed player">
      {UNCLAIMED_LABEL}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: Colors.warning,
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    overflow: 'hidden',
    alignSelf: 'center',
  },
});
