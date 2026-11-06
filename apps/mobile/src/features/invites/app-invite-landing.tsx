import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { clearPendingClaim } from '@/auth/pending-claim';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { OpenInApp } from '@/components/open-in-app';
import { ORDINARY_SIGN_IN_MODE } from '@/features/auth/login-screen';
import { appInviteAppUrl } from '@/lib/app-links';
import { displayName } from '@/lib/users';
import { Palette, Spacing, Typography } from '@/theme';

import { UnusableLink } from './claim-screen';
import { isNotFound, useAppInvitePreview } from './queries';

export const INVITE_INVALID_TITLE = "This invitation link isn't valid";
export const INVITE_INVALID_TEXT =
  'It may have been replaced by a newer link. Ask the person who invited you to send it again, or sign in directly.';
export const INVITE_LOAD_FAILED_TEXT = "Couldn't load this invitation.";

/**
 * A general invitation is never a claim: a claim left pending by an abandoned claim sign-in is
 * dropped, and the login screen is told to sign in normally even if dropping it failed.
 */
async function continueToOrdinarySignIn() {
  await clearPendingClaim().catch(() => undefined);
  router.push({ pathname: '/login', params: { mode: ORDINARY_SIGN_IN_MODE } });
}

/** Public landing for a general app invitation. It never signs anyone in or claims a player. */
export function AppInviteLanding({ token }: { token: string }) {
  const preview = useAppInvitePreview(token);
  const { session, user } = useSession();

  if (preview.isPending) return <CenteredLoading />;
  if (preview.isError) {
    if (isNotFound(preview.error)) {
      return <UnusableLink title={INVITE_INVALID_TITLE} message={INVITE_INVALID_TEXT} />;
    }
    return (
      <EmptyState
        title={INVITE_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void preview.refetch()}
      />
    );
  }

  const inviter = displayName(preview.data.invitedBy);
  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title} testID="app-invite-title">
        {inviter} invited you to Sharkulator
      </Text>
      <Text style={styles.text}>
        Track your games, Elo ratings and rivalries with your friends, office or club.
      </Text>
      <OpenInApp url={appInviteAppUrl(token)} />
      {session ? (
        <View style={styles.actions}>
          <Text style={styles.text}>You are already signed in as @{user?.username}.</Text>
          <Button title="Open Sharkulator" onPress={() => router.replace('/feed')} />
        </View>
      ) : (
        <Button
          title="Sign in to get started"
          testID="app-invite-sign-in"
          onPress={() => void continueToOrdinarySignIn()}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.lg,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  title: { ...Typography.title, textAlign: 'center' },
  text: { ...Typography.bodySecondary, textAlign: 'center' },
  actions: { gap: Spacing.md },
});
