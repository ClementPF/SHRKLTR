import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { InboxNotification } from '@/api/types';
import { Button } from '@/components/button';
import { showAlert } from '@/components/dropdown-alert';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { flattenPages } from '@/features/users/queries';
import { fromNow } from '@/lib/format';
import { notificationTargetHref } from '@/notifications/targets';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import {
  useInbox,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useUnreadCount,
} from './queries';

export const EMPTY_INBOX_TEXT =
  'No notifications yet.\nRecorded games, badges you earn and players claiming their profile will show up here.';
export const INBOX_LOAD_FAILED_TEXT = "Couldn't load your notifications.";

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function NotificationRow({
  notification,
  onPress,
}: {
  notification: InboxNotification;
  onPress(): void;
}) {
  const unread = notification.readAt === null;
  const when = fromNow(notification.createdAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread' : 'Read'}: ${sentence(notification.title)} ${sentence(notification.body)} ${when}`}
      testID={`notification-${notification.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        unread ? styles.unreadRow : styles.readRow,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.text}>
        <Text style={[styles.title, !unread && styles.readText]} numberOfLines={2}>
          {notification.title}
        </Text>
        <Text style={[styles.body, !unread && styles.readText]} numberOfLines={3}>
          {notification.body}
        </Text>
        <Text style={styles.when}>{when}</Text>
      </View>
      {unread && <View style={styles.dot} testID={`notification-${notification.id}-unread`} />}
    </Pressable>
  );
}

export function InboxScreen() {
  const inbox = useInbox();
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [refreshing, setRefreshing] = useState(false);

  if (inbox.isPending) return <CenteredLoading />;
  if (inbox.isError) {
    return (
      <EmptyState
        title={INBOX_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void inbox.refetch()}
      />
    );
  }

  const rows = flattenPages(inbox.data);
  if (rows.length === 0) return <EmptyState title={EMPTY_INBOX_TEXT} />;

  const hasUnread = (unread.data?.count ?? 0) > 0 || rows.some((row) => row.readAt === null);

  const open = (notification: InboxNotification) => {
    // Reopening a read row never marks (or decrements the count) again.
    if (notification.readAt === null) markRead.mutate(notification.id);
    if (notification.target) router.push(notificationTargetHref(notification.target));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([inbox.refetch(), unread.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={Palette.screen}>
      <FlatList
        testID="inbox-list"
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.toolbar}>
            <Button
              title="Mark all read"
              variant="secondary"
              disabled={!hasUnread}
              loading={markAll.isPending}
              onPress={() =>
                markAll.mutate(undefined, {
                  onError: (err) =>
                    showAlert('error', 'Error', `Couldn't mark notifications read: ${err.message}`),
                })
              }
            />
          </View>
        }
        renderItem={({ item }) => (
          <NotificationRow notification={item} onPress={() => open(item)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.text}
          />
        }
        onEndReached={() => {
          if (inbox.hasNextPage && !inbox.isFetchingNextPage) void inbox.fetchNextPage();
        }}
        onEndReachedThreshold={1}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.sm },
  toolbar: { alignItems: 'flex-end', marginBottom: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
  },
  unreadRow: {
    backgroundColor: Colors.surfaceRaised,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
  },
  readRow: { backgroundColor: Colors.background, borderColor: Colors.border },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: Spacing.xs },
  title: { ...Typography.body, fontWeight: '700' },
  body: { ...Typography.bodySecondary, fontSize: 14 },
  readText: { color: Colors.textMuted, fontWeight: '400' },
  when: { ...Typography.caption },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
});
