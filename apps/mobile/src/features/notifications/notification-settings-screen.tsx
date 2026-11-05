import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import type { NotificationCategory } from '@/api/types';
import { showAlert } from '@/components/dropdown-alert';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { useNotificationPreferences, useUpdateNotificationPreferences } from './queries';

export const PUSH_ONLY_TEXT =
  'These switches only control push notifications on your phone. Your inbox always records every notification, whatever you choose here.';
export const WEB_PUSH_TEXT = 'Push notifications are delivered to the mobile app only.';
export const PREFERENCES_LOAD_FAILED_TEXT = "Couldn't load your notification settings.";

export const CATEGORIES: { key: NotificationCategory; title: string; description: string }[] = [
  { key: 'games', title: 'Games', description: 'A game you played in was recorded.' },
  {
    key: 'challenges',
    title: 'Challenges',
    description: 'Challenges you receive, their answers, reminders and expiry.',
  },
  { key: 'achievements', title: 'Achievements', description: 'You unlocked a badge.' },
  { key: 'claims', title: 'Claims', description: 'Someone claimed a player you added by name.' },
  { key: 'groups', title: 'Groups', description: 'Someone joined a group you manage.' },
];

export function NotificationSettingsScreen() {
  const preferences = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  if (preferences.isPending) return <CenteredLoading />;
  if (preferences.isError) {
    return (
      <EmptyState
        title={PREFERENCES_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void preferences.refetch()}
      />
    );
  }

  const toggle = (key: NotificationCategory, value: boolean) => {
    update.mutate(
      { [key]: value },
      {
        onError: (err) =>
          showAlert('error', 'Error', `Couldn't save your notification settings: ${err.message}`),
      },
    );
  };

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <Text style={styles.explain} testID="push-only-explanation">
        {PUSH_ONLY_TEXT}
      </Text>
      {Platform.OS === 'web' && <Text style={styles.note}>{WEB_PUSH_TEXT}</Text>}
      <Text style={Palette.sectionHeader}>PUSH NOTIFICATIONS</Text>
      {CATEGORIES.map(({ key, title, description }) => (
        <View key={key} style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.description}>{description}</Text>
          </View>
          <Switch
            accessibilityLabel={`${title} push notifications`}
            testID={`push-toggle-${key}`}
            value={preferences.data[key]}
            onValueChange={(value) => toggle(key, value)}
            trackColor={{ false: Colors.border, true: Colors.accent }}
            thumbColor={Colors.text}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  explain: { ...Typography.bodySecondary, lineHeight: 22 },
  note: { ...Typography.caption },
  row: { ...Palette.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  text: { flex: 1, gap: Spacing.xs },
  title: { ...Typography.body, fontWeight: '700' },
  description: { ...Typography.bodySecondary, fontSize: 14 },
});
