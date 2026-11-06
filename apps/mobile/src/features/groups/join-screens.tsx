import dayjs from 'dayjs';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/errors';
import type { GroupJoinResult } from '@/api/types';
import { clearPendingJoin } from '@/auth/pending-join';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { OpenInApp } from '@/components/open-in-app';
import { UnusableLink } from '@/features/invites/claim-screen';
import { joinGroupAppUrl } from '@/lib/app-links';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import { normalizeInviteCode, signInToJoin } from './pending-join';
import { usePendingJoin } from './use-pending-join';
import { isNotFound, useGroupInvitePreview, useJoinGroup } from './queries';

export const INVITE_INVALID = 'INVITE_INVALID';
export const JOIN_LINK_INVALID_TITLE = "This invite link isn't valid";
export const JOIN_LINK_INVALID_TEXT =
  'It may have expired or been revoked. Ask a group owner or admin for a new invite.';
export const JOIN_LINK_LOAD_FAILED_TEXT = "Couldn't load this invitation.";
export const JOIN_CODE_INVALID_TEXT =
  "That code isn't valid. It may be mistyped, expired or revoked. Check it or ask for a new invite.";
export const JOIN_CODE_REQUIRED_TEXT = 'Enter the code you were given.';

const ignore = () => undefined;

function joinFailureMessage(err: Error, invalidText: string): string {
  return err instanceof ApiError && err.code === INVITE_INVALID ? invalidText : err.message;
}

function openJoinedGroup({ group }: GroupJoinResult) {
  router.replace({ pathname: '/groups/[id]', params: { id: group.id } });
}

function leaveJoinScreen(signedIn: boolean) {
  if (router.canGoBack()) router.back();
  else router.replace(signedIn ? '/groups' : '/');
}

/** Public /join/<token>: previews the invitation; joining always needs a signed-in confirmation. */
export function JoinLinkScreen({ token }: { token: string }) {
  const preview = useGroupInvitePreview(token);
  const { session, user } = useSession();
  const join = useJoinGroup();
  const linkDead =
    isNotFound(preview.error) ||
    (join.error instanceof ApiError && join.error.code === INVITE_INVALID);

  useEffect(() => {
    // A dead invitation can't be resumed; drop it so sign-in stops offering it.
    if (linkDead) void clearPendingJoin().catch(ignore);
  }, [linkDead]);

  if (preview.isPending) return <CenteredLoading />;
  if (linkDead)
    return <UnusableLink title={JOIN_LINK_INVALID_TITLE} message={JOIN_LINK_INVALID_TEXT} />;
  if (preview.isError) {
    return (
      <EmptyState
        title={JOIN_LINK_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void preview.refetch()}
      />
    );
  }

  const { groupName, expiresAt } = preview.data;
  const confirm = () =>
    join.mutate(
      { token },
      {
        onSuccess: (result) => {
          void clearPendingJoin().catch(ignore);
          openJoinedGroup(result);
        },
      },
    );
  const cancel = () => {
    void clearPendingJoin().catch(ignore);
    leaveJoinScreen(!!session);
  };

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>GROUP INVITATION</Text>
      <Text style={styles.title} testID="join-group-name">
        {session ? `Join ${groupName}?` : `You're invited to join ${groupName}`}
      </Text>
      <Text style={styles.text}>
        Members see the group's tournaments, games and standings. You join as a member.
      </Text>
      {expiresAt && (
        <Text style={styles.caption}>
          Invitation expires {dayjs(expiresAt).format('MMM D, YYYY')}
        </Text>
      )}
      {!session && <OpenInApp url={joinGroupAppUrl(token)} />}
      {session ? (
        <View style={styles.actions}>
          <Text style={styles.text}>Signed in as @{user?.username}.</Text>
          <Button
            title="Join group"
            testID="join-group-confirm"
            loading={join.isPending}
            onPress={confirm}
          />
          <Button title="Cancel" variant="secondary" disabled={join.isPending} onPress={cancel} />
          {join.isError && (
            <Text style={styles.error} accessibilityRole="alert" testID="join-error">
              Couldn't join: {join.error.message}
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            title="Sign in to join"
            testID="join-sign-in"
            onPress={() => void signInToJoin({ token, groupName })}
          />
          <Button title="Cancel" variant="secondary" onPress={cancel} />
        </View>
      )}
    </ScrollView>
  );
}

/** Public /join: short-code entry. Signed out, the code is kept for after sign-in. */
export function JoinCodeScreen() {
  const { session } = useSession();
  const pendingJoin = usePendingJoin(!!session);
  const resumed = pendingJoin.pending && 'code' in pendingJoin.pending ? pendingJoin.pending : null;
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const join = useJoinGroup();
  const normalized = normalizeInviteCode(code);

  useEffect(() => {
    if (resumed) setCode(resumed.code);
  }, [resumed]);

  const submit = () => {
    setTouched(true);
    if (!normalized || join.isPending) return;
    if (!session) {
      void signInToJoin({ code: normalized });
      return;
    }
    join.mutate(
      { code: normalized },
      {
        onSuccess: (result) => {
          pendingJoin.discard();
          openJoinedGroup(result);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === INVITE_INVALID) pendingJoin.discard();
        },
      },
    );
  };

  const cancel = () => {
    pendingJoin.discard();
    void clearPendingJoin().catch(ignore);
    leaveJoinScreen(!!session);
  };

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.kicker}>JOIN A GROUP</Text>
      <Text style={styles.title}>Enter an invite code</Text>
      {resumed ? (
        <Text style={styles.text} testID="join-code-resumed">
          You entered this code before signing in. Confirm to join the group as a member.
        </Text>
      ) : (
        <Text style={styles.text}>
          Ask a group owner or admin for the 10-character code. Upper or lower case both work.
        </Text>
      )}
      <TextInput
        testID="join-code-input"
        accessibilityLabel="Invite code"
        value={code}
        onChangeText={(text) => {
          setCode(text);
          join.reset();
        }}
        placeholder="ABCD234XYZ"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={40}
        style={styles.input}
        onSubmitEditing={submit}
      />
      {touched && !normalized && (
        <Text style={styles.error} accessibilityRole="alert">
          {JOIN_CODE_REQUIRED_TEXT}
        </Text>
      )}
      {join.isError && (
        <Text style={styles.error} accessibilityRole="alert" testID="join-error">
          {joinFailureMessage(join.error, JOIN_CODE_INVALID_TEXT)}
        </Text>
      )}
      <View style={styles.actions}>
        <Button
          title={session ? 'Join group' : 'Sign in to join'}
          testID="join-code-submit"
          loading={join.isPending}
          disabled={!normalized}
          onPress={submit}
        />
        <Button title="Cancel" variant="secondary" disabled={join.isPending} onPress={cancel} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  kicker: { ...Typography.caption, letterSpacing: 2, textAlign: 'center' },
  title: { ...Typography.title, textAlign: 'center' },
  text: { ...Typography.bodySecondary, textAlign: 'center' },
  caption: { ...Typography.caption, textAlign: 'center' },
  error: { ...Typography.body, color: Colors.warning, textAlign: 'center' },
  actions: { gap: Spacing.sm },
  input: {
    ...Typography.title,
    fontSize: 22,
    letterSpacing: 3,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
});
