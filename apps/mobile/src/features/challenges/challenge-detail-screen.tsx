import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/errors';
import type { Challenge, User } from '@/api/types';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { showAlert } from '@/components/dropdown-alert';
import { CenteredLoading, EmptyState } from '@/components/list-parts';
import { openGame } from '@/features/games/queries';
import { useEvictWhenDenied } from '@/features/groups/use-group-access';
import { fromNow, gameDate } from '@/lib/format';
import { displayName } from '@/lib/users';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { CHALLENGE_LOAD_FAILED_TEXT, ChallengeNotFound, StatusBadge } from './challenge-parts';
import { canRespond, isPastDeadline, rivalOf } from './format';
import { isChallengeMissing, useChallenge, useRespondToChallenge } from './queries';

export const GAME_UNAVAILABLE_TEXT = 'The deciding game is no longer available.';

/** What the viewer should know about the challenge's current state. */
export function challengeStateText(
  challenge: Challenge,
  viewerId: string | undefined,
  now: Date,
): string {
  const rival = rivalOf(challenge, viewerId).username;
  const tournament = challenge.tournament.displayName;
  const youAreOpponent = challenge.opponent.id === viewerId;
  switch (challenge.status) {
    case 'PENDING':
      if (isPastDeadline(challenge, now)) {
        return 'The deadline passed before an answer. This challenge is expiring.';
      }
      return youAreOpponent
        ? `${rival} challenged you in ${tournament}. Accept to play them before the deadline, or decline.`
        : `Waiting for ${rival} to accept or decline.`;
    case 'ACCEPTED':
      if (isPastDeadline(challenge, now)) {
        return 'The deadline passed without a game between you. This challenge is expiring.';
      }
      return `Accepted. Your next game against ${rival} in ${tournament} before the deadline decides it.`;
    case 'COMPLETED': {
      const winner = challenge.winner;
      if (!winner) return 'Completed.';
      return winner.id === viewerId
        ? 'You won this challenge.'
        : `${winner.username} won this challenge.`;
    }
    case 'DECLINED':
      return youAreOpponent ? 'You declined this challenge.' : `${rival} declined this challenge.`;
    case 'EXPIRED':
      return 'This challenge expired without a game. Nobody lost any points.';
  }
}

export function respondErrorText(error: Error): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'CHALLENGE_EXPIRED':
        return 'This challenge has expired.';
      case 'CHALLENGE_NOT_PENDING':
        return 'This challenge was already answered.';
      case 'NOT_CHALLENGE_OPPONENT':
        return 'Only the challenged player can answer.';
    }
  }
  return `Couldn't answer the challenge: ${error.message}`;
}

function Field({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function PlayerLink({ role, user, viewerId }: { role: string; user: User; viewerId?: string }) {
  const you = user.id === viewerId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${role} ${user.username}${you ? ' (you)' : ''}`}
      onPress={() =>
        router.push({ pathname: '/user/[username]', params: { username: user.username } })
      }
      style={({ pressed }) => [styles.player, pressed && styles.pressed]}
    >
      <Text style={styles.fieldLabel}>{role.toUpperCase()}</Text>
      <Text style={styles.playerName} numberOfLines={1}>
        {displayName(user)}
        {you ? ' (you)' : ''}
      </Text>
      <Text style={styles.caption}>@{user.username}</Text>
    </Pressable>
  );
}

function when(iso: string, now: Date): string {
  return `${gameDate(iso)} (${fromNow(iso, now)})`;
}

export function ChallengeDetailScreen({ id, viewerId }: { id: string; viewerId?: string }) {
  const challenge = useChallenge(id);
  const respond = useRespondToChallenge(id);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const missing = isChallengeMissing(challenge.error);
  // A refused read can mean the tournament's group was left: drop what could still show it.
  useEvictWhenDenied(
    missing,
    challenge.data?.tournament.name,
    challenge.data?.tournament.group?.id,
  );

  if (missing) return <ChallengeNotFound />;
  if (challenge.isPending) return <CenteredLoading />;
  if (challenge.isError) {
    return (
      <EmptyState
        title={CHALLENGE_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void challenge.refetch()}
      />
    );
  }

  const c = challenge.data;
  const now = new Date();
  const answerable = canRespond(c, viewerId, now);

  const answer = (response: 'ACCEPT' | 'DECLINE') =>
    respond.mutate(response, {
      onSuccess: () => {
        setConfirmDecline(false);
        showAlert(
          'success',
          response === 'ACCEPT' ? 'Challenge accepted' : 'Challenge declined',
          response === 'ACCEPT'
            ? `Your next game against ${c.challenger.username} decides it.`
            : `${c.challenger.username} will be told.`,
        );
      },
      onError: (err) => {
        setConfirmDecline(false);
        showAlert('error', 'Error', respondErrorText(err));
      },
    });

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await challenge.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      style={Palette.screen}
      contentContainerStyle={styles.content}
      testID="challenge-detail"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={Colors.text}
        />
      }
    >
      <View style={styles.headline}>
        <Text style={styles.title} numberOfLines={2}>
          {c.challenger.username} vs {c.opponent.username}
        </Text>
        <StatusBadge status={c.status} testID="challenge-status" />
      </View>

      <View style={styles.players}>
        <PlayerLink role="Challenger" user={c.challenger} viewerId={viewerId} />
        <PlayerLink role="Opponent" user={c.opponent} viewerId={viewerId} />
      </View>

      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open tournament ${c.tournament.displayName}`}
          onPress={() =>
            router.push({
              pathname: '/tournament/[name]',
              params: { name: c.tournament.name, displayName: c.tournament.displayName },
            })
          }
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Field
            label="TOURNAMENT"
            value={
              c.tournament.group
                ? `${c.tournament.displayName} · ${c.tournament.group.name}`
                : c.tournament.displayName
            }
            testID="challenge-tournament"
          />
        </Pressable>
        <Field label="DEADLINE" value={when(c.deadlineAt, now)} testID="challenge-deadline" />
        <Field label="SENT" value={when(c.createdAt, now)} />
        {c.acceptedAt && <Field label="ACCEPTED" value={when(c.acceptedAt, now)} />}
        {c.resolvedAt && c.status !== 'COMPLETED' && (
          <Field
            label={c.status === 'DECLINED' ? 'DECLINED' : 'ENDED'}
            value={when(c.resolvedAt, now)}
          />
        )}
        {c.status === 'COMPLETED' && c.winner && (
          <Field label="WINNER" value={c.winner.username} testID="challenge-winner" />
        )}
      </View>

      <Text style={styles.state} testID="challenge-state-text">
        {challengeStateText(c, viewerId, now)}
      </Text>

      {answerable && (
        <View style={styles.actions}>
          <Button
            title="Accept challenge"
            testID="accept-challenge"
            loading={respond.isPending && respond.variables === 'ACCEPT'}
            disabled={respond.isPending}
            onPress={() => answer('ACCEPT')}
            style={styles.action}
          />
          <Button
            title="Decline challenge"
            variant="secondary"
            testID="decline-challenge"
            disabled={respond.isPending}
            onPress={() => setConfirmDecline(true)}
            style={styles.action}
          />
        </View>
      )}

      {c.status === 'COMPLETED' &&
        (c.gameId ? (
          <Button
            title="View game"
            variant="secondary"
            testID="challenge-game-link"
            onPress={() => openGame(c.gameId!)}
          />
        ) : (
          <Text style={styles.caption}>{GAME_UNAVAILABLE_TEXT}</Text>
        ))}

      <ConfirmDialog
        visible={confirmDecline}
        title="Decline challenge?"
        message={`${c.challenger.username} will be told you declined. Nobody loses points.`}
        confirmTitle="Decline"
        loading={respond.isPending}
        onConfirm={() => answer('DECLINE')}
        onCancel={() => setConfirmDecline(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.md },
  headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { ...Typography.title, fontSize: 22, flex: 1 },
  players: { flexDirection: 'row', gap: Spacing.sm },
  player: { ...Palette.card, flex: 1, gap: 2 },
  playerName: { ...Typography.body, fontWeight: '700' },
  card: { ...Palette.card, gap: Spacing.sm },
  field: { gap: 2 },
  fieldLabel: { ...Typography.caption, letterSpacing: 1 },
  fieldValue: { ...Typography.body },
  caption: { ...Typography.caption },
  state: { ...Typography.body, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1 },
  pressed: { opacity: 0.8 },
});
