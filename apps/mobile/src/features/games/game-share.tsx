import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { Game, GameShare } from '@/api/types';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { COPIED_TEXT, COPY_FAILED_TEXT } from '@/components/copyable-link';
import { copyText } from '@/lib/clipboard';
import { canShareLinks, shareLink } from '@/lib/share';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { useIssueGameShare, useMyGameShare, useRevokeGameShare } from './queries';

export const SHARE_DISCLOSURE_TEXT =
  'Anyone with the link can see this result, even from a members-only tournament.';
export const SHARE_SHEET_FAILED_TEXT =
  "Couldn't open sharing. Select the link above and copy it instead.";
export const SHARE_REVOKED_TEXT = 'Link revoked. It no longer shows this result.';

type Status =
  | { kind: 'copied' }
  | { kind: 'copy-failed' }
  | { kind: 'sheet-failed' }
  | { kind: 'revoked' }
  | { kind: 'error'; message: string };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function statusText(status: Status): string {
  switch (status.kind) {
    case 'copied':
      return COPIED_TEXT;
    case 'copy-failed':
      return COPY_FAILED_TEXT;
    case 'sheet-failed':
      return SHARE_SHEET_FAILED_TEXT;
    case 'revoked':
      return SHARE_REVOKED_TEXT;
    case 'error':
      return status.message;
  }
}

/** Only registered players of a game can issue a link for it. */
export function isGameParticipant(game: Game, viewer: string | undefined): boolean {
  return !!viewer && game.outcomes.some((o) => o.user.username === viewer);
}

/**
 * Share and revoke my public result link. Native opens the system share sheet; the web uses
 * navigator.share where the browser has it, and otherwise copies the link.
 */
export function GameShareActions({ game }: { game: Game }) {
  const share = useMyGameShare(game.id).data ?? null;
  const issue = useIssueGameShare(game.id);
  const revoke = useRevokeGameShare(game.id);
  const [sharing, setSharing] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const copyLink = async (link: GameShare) => {
    setStatus((await copyText(link.url)) ? { kind: 'copied' } : { kind: 'copy-failed' });
  };

  const offer = async (link: GameShare) => {
    const web = Platform.OS === 'web';
    if (canShareLinks()) {
      try {
        // A closed sheet ('dismissed') is a normal outcome and keeps the link.
        await shareLink({
          url: link.url,
          title: 'Sharkulator result',
          message: `${game.tournament.displayName} result on Sharkulator`,
        });
        return;
      } catch {
        // Browsers refuse navigator.share without a fresh tap (e.g. after the issue request);
        // copying still works there, and otherwise the selectable link is offered.
        if (!web) {
          setStatus({ kind: 'sheet-failed' });
          return;
        }
      }
    }
    await copyLink(link);
  };

  const onShare = async () => {
    setStatus(null);
    setSharing(true);
    try {
      let link = share;
      if (!link) {
        try {
          link = await issue.mutateAsync();
        } catch (err) {
          setStatus({ kind: 'error', message: `Couldn't create the link: ${errorMessage(err)}` });
          return;
        }
      }
      await offer(link);
    } finally {
      setSharing(false);
    }
  };

  const onRevoke = () => {
    if (!share) return;
    revoke.mutate(share.shareId, {
      onSuccess: () => setStatus({ kind: 'revoked' }),
      onError: (err) =>
        setStatus({ kind: 'error', message: `Couldn't revoke the link: ${errorMessage(err)}` }),
      onSettled: () => setConfirmRevoke(false),
    });
  };

  const failed =
    status?.kind === 'error' || status?.kind === 'copy-failed' || status?.kind === 'sheet-failed';

  return (
    <View style={styles.card} testID="game-share">
      <Button
        title="Share result"
        testID="game-share-button"
        loading={sharing}
        disabled={revoke.isPending}
        onPress={() => void onShare()}
      />
      <Text style={styles.caption}>{SHARE_DISCLOSURE_TEXT}</Text>
      {share && (
        <Text selectable style={styles.url} testID="game-share-url">
          {share.url}
        </Text>
      )}
      {status && (
        <Text
          style={failed ? styles.failure : styles.success}
          accessibilityRole={failed ? 'alert' : undefined}
          testID="game-share-status"
        >
          {statusText(status)}
        </Text>
      )}
      {share && (
        <View style={styles.row}>
          <Button
            title="Copy link"
            variant="secondary"
            disabled={sharing}
            style={styles.rowButton}
            onPress={() => void copyLink(share)}
          />
          <Button
            title="Revoke link"
            variant="secondary"
            disabled={sharing || revoke.isPending}
            style={styles.rowButton}
            onPress={() => setConfirmRevoke(true)}
          />
        </View>
      )}
      <ConfirmDialog
        visible={confirmRevoke}
        title="Revoke this link?"
        message="The link and its image stop showing this result. Previews already shown in messaging apps stay."
        confirmTitle="Revoke link"
        loading={revoke.isPending}
        onConfirm={onRevoke}
        onCancel={() => setConfirmRevoke(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, gap: Spacing.sm },
  caption: { ...Typography.caption },
  url: {
    ...Typography.body,
    fontSize: 14,
    backgroundColor: Colors.surfaceRaised,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  success: { ...Typography.caption, color: Colors.success },
  failure: { ...Typography.caption, color: Colors.warning },
  row: { flexDirection: 'row', gap: Spacing.sm },
  rowButton: { flex: 1 },
});
