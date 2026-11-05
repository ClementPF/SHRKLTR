import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyableLink } from '@/components/copyable-link';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { hydrateIssuedLinks, useIssuedLinksStore } from './issued-links';
import { useIssueAppInvite } from './queries';

export const APP_INVITE_INTRO =
  'Send this link to friends so they can join Sharkulator and start recording games with you. It does not hand over any player profile: to let someone take over games you recorded for them, use Invited players.';
export const APP_INVITE_ROTATE_TEXT =
  'Your current invitation link will stop working. Anyone you already sent it to will need the new one.';

/** Settings › Invite to Sharkulator: shows, copies and replaces the reusable invitation link. */
export function AppInviteScreen({ ownerId }: { ownerId: string | undefined }) {
  const url = useIssuedLinksStore((s) => (s.ownerId === ownerId ? s.appInviteUrl : null));
  const hydrated = useIssuedLinksStore((s) => s.ownerId === ownerId && s.hydrated);
  const issue = useIssueAppInvite(ownerId);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (ownerId) void hydrateIssuedLinks(ownerId);
  }, [ownerId]);

  const create = () =>
    issue.mutate(undefined, {
      onSettled: () => setConfirming(false),
    });

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>{APP_INVITE_INTRO}</Text>
      {url ? (
        <View style={styles.block}>
          <CopyableLink url={url} testID="app-invite-link" />
          <Button
            title="Get a new link"
            variant="secondary"
            disabled={issue.isPending}
            onPress={() => setConfirming(true)}
          />
        </View>
      ) : (
        <Button
          title="Create invite link"
          testID="app-invite-create"
          loading={issue.isPending}
          disabled={!hydrated}
          onPress={create}
        />
      )}
      {issue.isError && (
        <Text style={styles.error} accessibilityRole="alert">
          Couldn't create the invitation link: {issue.error.message}
        </Text>
      )}
      <ConfirmDialog
        visible={confirming}
        title="Get a new link?"
        message={APP_INVITE_ROTATE_TEXT}
        confirmTitle="Get new link"
        loading={issue.isPending}
        onConfirm={create}
        onCancel={() => setConfirming(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.lg },
  intro: { ...Typography.bodySecondary },
  block: { gap: Spacing.md },
  error: { ...Typography.body, color: Colors.warning },
});
