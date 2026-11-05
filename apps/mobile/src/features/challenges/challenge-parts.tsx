import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import type { ChallengeStatus } from '@/api/types';
import { EmptyState } from '@/components/list-parts';
import { Colors, Radius, Spacing, Typography } from '@/theme';

import { STATUS_LABELS } from './format';

export const CHALLENGE_NOT_FOUND_TEXT = "This challenge doesn't exist or you can't see it.";
export const CHALLENGE_LOAD_FAILED_TEXT = "Couldn't load this challenge.";

const STATUS_COLORS: Record<ChallengeStatus, string> = {
  PENDING: Colors.warning,
  ACCEPTED: Colors.accent,
  COMPLETED: Colors.success,
  DECLINED: Colors.textMuted,
  EXPIRED: Colors.textMuted,
};

export function StatusBadge({ status, testID }: { status: ChallengeStatus; testID?: string }) {
  const color = STATUS_COLORS[status];
  return (
    <Text
      style={[styles.badge, { color, borderColor: color }]}
      testID={testID}
      accessibilityLabel={`Status ${STATUS_LABELS[status]}`}
    >
      {status}
    </Text>
  );
}

export function ChallengeNotFound() {
  return (
    <EmptyState
      title={CHALLENGE_NOT_FOUND_TEXT}
      actionTitle="Go to my challenges"
      onAction={() => router.replace('/challenges')}
    />
  );
}

const styles = StyleSheet.create({
  badge: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    overflow: 'hidden',
    alignSelf: 'center',
  },
});
