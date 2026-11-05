import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { InvitedPlayer, InvitedPlayerStatus } from '@/api/types';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyableLink } from '@/components/copyable-link';
import { showAlert } from '@/components/dropdown-alert';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { useErrorAlert } from '@/features/users/use-error-alert';
import { displayName } from '@/lib/users';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { formatDate } from './claim-screen';
import { hydrateIssuedLinks, useIssuedLinksStore } from './issued-links';
import { useInvitedPlayers, useReissueClaimLink, useRevokeClaimLink } from './queries';

export const NO_INVITED_PLAYERS_TEXT =
  'You have not added anyone by name yet. When you record a game, use “Add player by name” for someone without an account, then send them their claim link from here.';
export const INVITED_LOAD_FAILED_TEXT = "Couldn't load your invited players.";

export const STATUS_LABELS: Record<InvitedPlayerStatus, string> = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  CLAIMED: 'CLAIMED',
};

const STATUS_COLORS: Record<InvitedPlayerStatus, string> = {
  ACTIVE: Colors.success,
  EXPIRED: Colors.textMuted,
  REVOKED: Colors.error,
  CLAIMED: Colors.accent,
};

export function statusDetail(player: InvitedPlayer): string {
  switch (player.status) {
    case 'ACTIVE':
      return `Waiting to be claimed. Link expires ${formatDate(player.claimExpiresAt)}.`;
    case 'EXPIRED':
      return `Link expired ${formatDate(player.claimExpiresAt)}. Issue a new link to invite them.`;
    case 'REVOKED':
      return `Link revoked${player.claimRevokedAt ? ` ${formatDate(player.claimRevokedAt)}` : ''}. Issue a new link to invite them.`;
    case 'CLAIMED':
      return `Claimed${player.claimedAt ? ` ${formatDate(player.claimedAt)}` : ''}. They now sign in with their own account.`;
  }
}

type Pending = { kind: 'reissue' | 'revoke'; player: InvitedPlayer } | null;

function InvitedPlayerRow({
  player,
  heldUrl,
  busy,
  onReissue,
  onRevoke,
}: {
  player: InvitedPlayer;
  heldUrl: string | undefined;
  busy: boolean;
  onReissue(): void;
  onRevoke(): void;
}) {
  const { status, user } = player;
  return (
    <View style={styles.row} testID={`invited-player-${user.username}`}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text style={styles.name}>{displayName(user)}</Text>
          <Text style={styles.username}>@{user.username}</Text>
        </View>
        <Text
          style={[
            styles.status,
            { color: STATUS_COLORS[status], borderColor: STATUS_COLORS[status] },
          ]}
          testID={`invited-player-${user.username}-status`}
        >
          {STATUS_LABELS[status]}
        </Text>
      </View>
      <Text style={styles.detail}>{statusDetail(player)}</Text>
      {status === 'ACTIVE' && heldUrl && (
        <CopyableLink url={heldUrl} testID={`claim-link-${user.username}`} />
      )}
      {status === 'ACTIVE' && !heldUrl && (
        <Text style={styles.detail}>
          The link was shown when it was created. Get a new link to copy it again.
        </Text>
      )}
      {status !== 'CLAIMED' && (
        <View style={styles.actions}>
          <Button
            title={status === 'ACTIVE' ? 'Get a new link' : 'Issue new link'}
            variant="secondary"
            disabled={busy}
            onPress={onReissue}
            style={styles.action}
          />
          {status === 'ACTIVE' && (
            <Button
              title="Revoke link"
              variant="secondary"
              disabled={busy}
              onPress={onRevoke}
              style={styles.action}
            />
          )}
        </View>
      )}
    </View>
  );
}

export function InvitedPlayersScreen({ ownerId }: { ownerId: string | undefined }) {
  const invited = useInvitedPlayers(ownerId);
  const reissue = useReissueClaimLink(ownerId);
  const revoke = useRevokeClaimLink(ownerId);
  const held = useIssuedLinksStore((s) => (s.ownerId === ownerId ? s.claims : null));
  const [pending, setPending] = useState<Pending>(null);
  const [refreshing, setRefreshing] = useState(false);
  useErrorAlert(invited.error, 'your invited players');

  useEffect(() => {
    if (ownerId) void hydrateIssuedLinks(ownerId);
  }, [ownerId]);

  if (invited.isPending) return <CenteredLoading />;
  if (invited.isError) {
    return (
      <EmptyState
        title={INVITED_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void invited.refetch()}
      />
    );
  }
  if (invited.data.length === 0) return <EmptyState title={NO_INVITED_PLAYERS_TEXT} />;

  const runReissue = (player: InvitedPlayer) => {
    reissue.mutate(player.user.id, {
      onSuccess: () => {
        setPending(null);
        showAlert('success', 'New link ready', `Send the new link to ${displayName(player.user)}.`);
      },
      onError: (err) => {
        setPending(null);
        showAlert('error', 'Error', `Couldn't issue a new link: ${err.message}`);
      },
    });
  };

  const runRevoke = (player: InvitedPlayer) => {
    revoke.mutate(player.user.id, {
      onSuccess: () => {
        setPending(null);
        showAlert('success', 'Link revoked', `${displayName(player.user)}'s link no longer works.`);
      },
      onError: (err) => {
        setPending(null);
        showAlert('error', 'Error', `Couldn't revoke the link: ${err.message}`);
      },
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await invited.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const busy = reissue.isPending || revoke.isPending;
  const confirmName = pending ? displayName(pending.player.user) : '';

  return (
    <View style={Palette.screen}>
      <FlatList
        testID="invited-players-list"
        data={invited.data}
        keyExtractor={(item) => item.user.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <InvitedPlayerRow
            player={item}
            heldUrl={held?.[item.user.id]?.url}
            busy={busy}
            onReissue={() =>
              item.status === 'ACTIVE'
                ? setPending({ kind: 'reissue', player: item })
                : runReissue(item)
            }
            onRevoke={() => setPending({ kind: 'revoke', player: item })}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.text}
          />
        }
      />
      <ConfirmDialog
        visible={pending !== null}
        title={pending?.kind === 'revoke' ? 'Revoke link?' : 'Get a new link?'}
        message={
          pending?.kind === 'revoke'
            ? `${confirmName}'s claim link will stop working. Their profile and games are kept, and you can issue a new link later.`
            : `${confirmName}'s current claim link will stop working and a new one, valid for 30 days, replaces it.`
        }
        confirmTitle={pending?.kind === 'revoke' ? 'Revoke' : 'Get new link'}
        loading={busy}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === 'revoke') runRevoke(pending.player);
          else runReissue(pending.player);
        }}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  row: { ...Palette.card, gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  identity: { flex: 1 },
  name: { ...Typography.body, fontWeight: '700' },
  username: { ...Typography.caption },
  status: {
    ...Typography.caption,
    fontWeight: '700',
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    overflow: 'hidden',
  },
  detail: { ...Typography.bodySecondary, fontSize: 14 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1 },
});
