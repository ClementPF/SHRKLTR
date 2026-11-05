import dayjs from 'dayjs';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GroupInvite, IssuedGroupInvite } from '@/api/types';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyableLink } from '@/components/copyable-link';
import { CenteredLoading, SectionTitle } from '@/components/list-parts';
import { QrDisplay } from '@/components/qr-display';
import { copyText } from '@/lib/clipboard';
import { canShareLinks, shareLink } from '@/lib/share';
import { displayName } from '@/lib/users';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { GroupLoadFailed, GroupNotFound } from './group-parts';
import { canManage, useCreateGroupInvite, useGroupInvites, useRevokeGroupInvite } from './queries';
import { useGroupAccess } from './use-group-access';

export const INVITE_MANAGERS_ONLY_TEXT = 'Only the group owner and admins can invite people.';
export const ONE_TIME_TEXT =
  "This link and code are shown only now. If you lose them, create a new invite: old ones can't be shown again.";
export const NO_INVITES_TEXT = 'No invites yet.';

type Expiry = 'default' | 'never';

function formatDate(iso: string): string {
  return dayjs(iso).format('MMM D, YYYY');
}

function expiryText(expiresAt: string | null): string {
  return expiresAt ? `Expires ${formatDate(expiresAt)}` : 'Never expires';
}

function inviteLine(invite: GroupInvite): string {
  const by = invite.createdBy ? ` by ${displayName(invite.createdBy)}` : '';
  const created = `Created ${formatDate(invite.createdAt)}${by}`;
  if (invite.status === 'REVOKED' && invite.revokedAt) {
    return `${created} · Revoked ${formatDate(invite.revokedAt)}`;
  }
  if (invite.status === 'EXPIRED' && invite.expiresAt) {
    return `${created} · Expired ${formatDate(invite.expiresAt)}`;
  }
  return `${created} · ${expiryText(invite.expiresAt)}`;
}

function IssuedInvite({ invite, groupName }: { invite: IssuedGroupInvite; groupName: string }) {
  const [codeCopy, setCodeCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [shareError, setShareError] = useState<string | null>(null);

  const copyCode = async () => setCodeCopy((await copyText(invite.code)) ? 'copied' : 'failed');
  const share = async () => {
    setShareError(null);
    try {
      await shareLink({
        url: invite.url,
        title: `Join ${groupName} on Sharkulator`,
        message: `Join ${groupName} on Sharkulator. Code: ${invite.code}`,
      });
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Sharing failed.');
    }
  };

  return (
    <View style={styles.card} testID="issued-invite">
      <Text style={styles.caption}>{ONE_TIME_TEXT}</Text>
      <Text style={styles.label}>SHORT CODE</Text>
      <Text style={styles.code} selectable testID="issued-invite-code">
        {invite.code}
      </Text>
      <Button title="Copy code" variant="secondary" onPress={() => void copyCode()} />
      {codeCopy === 'copied' && <Text style={styles.success}>Code copied.</Text>}
      {codeCopy === 'failed' && (
        <Text style={styles.warning} accessibilityRole="alert">
          Couldn't copy automatically. Select the code above and copy it.
        </Text>
      )}
      <Text style={styles.label}>LINK</Text>
      <CopyableLink url={invite.url} testID="issued-invite-link" />
      {canShareLinks() && <Button title="Share invite" onPress={() => void share()} />}
      {shareError && (
        <Text style={styles.warning} accessibilityRole="alert">
          {shareError}
        </Text>
      )}
      <Text style={styles.label}>QR CODE</Text>
      <QrDisplay value={invite.url} />
      <Text style={styles.caption}>{expiryText(invite.expiresAt)}</Text>
    </View>
  );
}

function InviteRow({
  invite,
  onRevoke,
  disabled,
}: {
  invite: GroupInvite;
  onRevoke(): void;
  disabled: boolean;
}) {
  return (
    <View style={styles.row} testID={`group-invite-${invite.id}`}>
      <View style={styles.rowText}>
        <Text style={styles.status} testID={`group-invite-${invite.id}-status`}>
          {invite.status}
        </Text>
        <Text style={styles.caption}>{inviteLine(invite)}</Text>
      </View>
      {invite.status === 'ACTIVE' && (
        <Button
          title="Revoke"
          variant="secondary"
          testID={`group-invite-${invite.id}-revoke`}
          disabled={disabled}
          onPress={onRevoke}
        />
      )}
    </View>
  );
}

function InviteManager({ id, groupName }: { id: string; groupName: string }) {
  const invites = useGroupInvites(id, true);
  const create = useCreateGroupInvite(id);
  const revoke = useRevokeGroupInvite(id);
  const [expiry, setExpiry] = useState<Expiry>('default');
  const [issued, setIssued] = useState<IssuedGroupInvite | null>(null);
  const [revoking, setRevoking] = useState<GroupInvite | null>(null);

  const issue = () =>
    create.mutate(expiry === 'never' ? { expiresAt: null } : {}, { onSuccess: setIssued });

  const confirmRevoke = () => {
    if (!revoking) return;
    const target = revoking;
    revoke.mutate(target.id, {
      onSuccess: () => {
        if (issued?.id === target.id) setIssued(null);
      },
      onSettled: () => setRevoking(null),
    });
  };

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        People who open the link, scan the QR code or enter the code join {groupName} as members.
      </Text>
      <View style={styles.chips}>
        {(
          [
            ['default', 'Expires in 30 days'],
            ['never', 'Never expires'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: expiry === value }}
            onPress={() => setExpiry(value)}
            style={[styles.chip, expiry === value && styles.chipSelected]}
          >
            <Text style={styles.chipText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Button
        title={issued ? 'Create another invite' : 'Create invite'}
        testID="create-group-invite"
        loading={create.isPending}
        onPress={issue}
      />
      {create.isError && (
        <Text style={styles.warning} accessibilityRole="alert">
          Couldn't create the invite: {create.error.message}
        </Text>
      )}
      {issued && <IssuedInvite key={issued.id} invite={issued} groupName={groupName} />}

      <SectionTitle title="INVITES" />
      {invites.isPending && <Text style={styles.caption}>Loading invites…</Text>}
      {invites.isError && (
        <Text style={styles.warning} accessibilityRole="alert">
          Couldn't load the invites: {invites.error.message}
        </Text>
      )}
      {invites.isSuccess && invites.data.length === 0 && (
        <Text style={styles.caption}>{NO_INVITES_TEXT}</Text>
      )}
      {invites.data?.map((invite) => (
        <InviteRow
          key={invite.id}
          invite={invite}
          disabled={revoke.isPending}
          onRevoke={() => setRevoking(invite)}
        />
      ))}
      {revoke.isError && (
        <Text style={styles.warning} accessibilityRole="alert">
          Couldn't revoke the invite: {revoke.error.message}
        </Text>
      )}
      <ConfirmDialog
        visible={!!revoking}
        title="Revoke this invite?"
        message="Its link, QR code and short code stop working. People who already joined stay in the group."
        confirmTitle="Revoke invite"
        loading={revoke.isPending}
        onConfirm={confirmRevoke}
        onCancel={() => setRevoking(null)}
      />
    </ScrollView>
  );
}

/** Invite management for owners and admins; members only see that they can't invite. */
export function GroupInviteScreen({ id }: { id: string }) {
  const { group, missing } = useGroupAccess(id);
  if (missing) return <GroupNotFound />;
  if (group.isPending) return <CenteredLoading />;
  if (!group.data) return <GroupLoadFailed onRetry={() => void group.refetch()} />;
  if (!canManage(group.data.role)) {
    return (
      <View style={[Palette.screen, styles.content]}>
        <Text style={styles.intro} testID="invite-managers-only">
          {INVITE_MANAGERS_ONLY_TEXT}
        </Text>
      </View>
    );
  }
  return <InviteManager id={id} groupName={group.data.name} />;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  intro: { ...Typography.bodySecondary },
  card: { ...Palette.card, gap: Spacing.sm },
  label: { ...Typography.caption, letterSpacing: 2, marginTop: Spacing.sm },
  code: {
    ...Typography.title,
    fontFamily: 'monospace',
    letterSpacing: 4,
    textAlign: 'center',
  },
  caption: { ...Typography.caption },
  success: { ...Typography.caption, color: Colors.success },
  warning: { ...Typography.body, color: Colors.warning },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceRaised,
  },
  chipSelected: { borderColor: Colors.accent },
  chipText: { ...Typography.body },
  row: { ...Palette.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowText: { flex: 1, gap: Spacing.xs },
  status: { ...Typography.body, fontWeight: '700' },
});
