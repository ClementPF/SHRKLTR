import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/errors';
import type { GroupMember, GroupRole } from '@/api/types';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { CenteredLoading } from '@/components/list-parts';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { flattenPages } from '@/features/users/queries';
import { displayName } from '@/lib/users';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { GroupLoadFailed, GroupNotFound, PersonRow, ROLE_LABELS } from './group-parts';
import {
  useGroupMembers,
  useLeaveGroup,
  useRemoveMember,
  useSetMemberRole,
  useTransferOwnership,
} from './queries';
import { useGroupAccess } from './use-group-access';

export const OWNER_TRANSFER_REQUIRED = 'OWNER_TRANSFER_REQUIRED';
export const OWNER_MUST_TRANSFER_TEXT =
  'You own this group, so you have to make another member the owner before you can leave.';

export type MemberAction = 'make-admin' | 'make-member' | 'make-owner' | 'remove';

/**
 * Actions the caller may take on a member: the owner manages everyone else (roles, removal,
 * ownership); an admin may only remove ordinary members; members manage nobody.
 */
export function memberActions(
  callerRole: GroupRole,
  target: GroupMember,
  callerId: string | undefined,
): MemberAction[] {
  if (target.user.id === callerId || target.role === 'OWNER') return [];
  if (callerRole === 'OWNER') {
    return [target.role === 'ADMIN' ? 'make-member' : 'make-admin', 'make-owner', 'remove'];
  }
  if (callerRole === 'ADMIN' && target.role === 'MEMBER') return ['remove'];
  return [];
}

const ACTION_TITLES: Record<MemberAction, string> = {
  'make-admin': 'Make admin',
  'make-member': 'Make member',
  'make-owner': 'Make owner',
  remove: 'Remove',
};

type Pending = { kind: 'remove' | 'make-owner'; member: GroupMember } | { kind: 'leave' } | null;

function errorText(err: Error): string {
  if (err instanceof ApiError && err.code === OWNER_TRANSFER_REQUIRED) {
    return OWNER_MUST_TRANSFER_TEXT;
  }
  return err.message;
}

export function GroupMembersScreen({ id }: { id: string }) {
  const me = useSession().user;
  const members = useGroupMembers(id);
  const { group, missing } = useGroupAccess(id, members);
  const setRole = useSetMemberRole(id);
  const remove = useRemoveMember(id);
  const transfer = useTransferOwnership(id);
  const leave = useLeaveGroup(id);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (missing && !leave.isSuccess) return <GroupNotFound />;
  if (group.isPending || members.isPending) return <CenteredLoading />;
  if (!group.data) return <GroupLoadFailed onRetry={() => void group.refetch()} />;

  const myRole = group.data.role;
  const busy = setRole.isPending || remove.isPending || transfer.isPending || leave.isPending;
  const report = {
    onError: (err: Error) => {
      setNotice(null);
      setError(errorText(err));
    },
  };
  const done = (message: string) => {
    setError(null);
    setNotice(message);
  };

  const act = (action: MemberAction, member: GroupMember) => {
    const name = displayName(member.user);
    setError(null);
    setNotice(null);
    if (action === 'remove' || action === 'make-owner') {
      setPending({ kind: action, member });
      return;
    }
    const role = action === 'make-admin' ? 'ADMIN' : 'MEMBER';
    setRole.mutate(
      { userId: member.user.id, role },
      { ...report, onSuccess: () => done(`${name} is now ${ROLE_LABELS[role].toLowerCase()}.`) },
    );
  };

  const confirm = () => {
    if (!pending) return;
    const close = { onSettled: () => setPending(null) };
    if (pending.kind === 'leave') {
      leave.mutate(undefined, {
        ...report,
        ...close,
        onSuccess: () => router.replace('/groups'),
      });
      return;
    }
    const { member } = pending;
    const name = displayName(member.user);
    if (pending.kind === 'remove') {
      remove.mutate(member.user.id, {
        ...report,
        ...close,
        onSuccess: () => done(`${name} was removed from the group.`),
      });
    } else {
      transfer.mutate(member.user.id, {
        ...report,
        ...close,
        onSuccess: () => done(`${name} is now the owner. You are an admin.`),
      });
    }
  };

  const dialog =
    pending?.kind === 'leave'
      ? {
          title: 'Leave this group?',
          message: `You will lose access to ${group.data.name}, its tournaments and standings. You need a new invite to come back.`,
          confirmTitle: 'Leave group',
        }
      : pending?.kind === 'remove'
        ? {
            title: `Remove ${displayName(pending.member.user)}?`,
            message: 'They will lose access to the group, its tournaments and standings.',
            confirmTitle: 'Remove',
          }
        : pending?.kind === 'make-owner'
          ? {
              title: `Make ${displayName(pending.member.user)} the owner?`,
              message:
                'They become the only owner and you become an admin. Only the new owner can undo this.',
              confirmTitle: 'Transfer ownership',
            }
          : null;

  const list = flattenPages(members.data);

  return (
    <View style={Palette.screen}>
      <FlatList
        testID="group-members-list"
        data={list}
        keyExtractor={(m) => m.user.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.caption}>
              {myRole === 'MEMBER'
                ? 'Only the owner and admins can manage members.'
                : myRole === 'ADMIN'
                  ? 'As an admin you can remove members. Only the owner can change roles.'
                  : 'As the owner you can change roles, remove people and hand over ownership.'}
            </Text>
            {error && (
              <Text style={styles.error} accessibilityRole="alert" testID="members-error">
                {error}
              </Text>
            )}
            {notice && (
              <Text style={styles.notice} testID="members-notice">
                {notice}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const actions = memberActions(myRole, item, me?.id);
          const name = item.user.username;
          return (
            <View style={styles.member}>
              <PersonRow user={item.user} role={item.role} testID={`member-${name}`} />
              {actions.length > 0 && (
                <View style={styles.actions}>
                  {actions.map((action) => (
                    <Button
                      key={action}
                      title={ACTION_TITLES[action]}
                      testID={`member-${name}-${action}`}
                      variant="secondary"
                      disabled={busy}
                      onPress={() => act(action, item)}
                      style={styles.action}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        }}
        ItemSeparatorComponent={Separator}
        onEndReached={() => {
          if (members.hasNextPage && !members.isFetchingNextPage) void members.fetchNextPage();
        }}
        ListFooterComponent={
          <Button
            title="Leave group"
            testID="leave-group"
            disabled={busy}
            onPress={() => {
              setError(null);
              setNotice(null);
              setPending({ kind: 'leave' });
            }}
            style={styles.leave}
          />
        }
      />
      <ConfirmDialog
        visible={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        confirmTitle={dialog?.confirmTitle ?? ''}
        loading={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md },
  header: { gap: Spacing.sm, marginBottom: Spacing.md },
  caption: { ...Typography.caption },
  error: { ...Typography.body, color: Colors.warning },
  notice: { ...Typography.body, color: Colors.success },
  member: { gap: Spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  action: { minHeight: 36, flexGrow: 1 },
  separator: { height: Spacing.sm },
  leave: { marginTop: Spacing.lg },
});
