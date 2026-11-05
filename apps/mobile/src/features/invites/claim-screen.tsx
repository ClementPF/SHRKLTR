import dayjs from 'dayjs';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ClaimPreview } from '@/api/types';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { GameRow } from '@/components/game-row';
import { CenteredLoading, EmptyState, SectionTitle } from '@/components/list-parts';
import { OpenInApp } from '@/components/open-in-app';
import { UnclaimedBadge } from '@/components/unclaimed-badge';
import { claimInviteAppUrl } from '@/lib/app-links';
import { formatPoints } from '@/lib/format';
import { displayName } from '@/lib/users';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import {
  CLAIM_UNUSABLE_TEXT,
  NEW_ACCOUNT_ONLY_TEXT,
  useClaimSignIn,
  type ClaimTarget,
} from './claim-sign-in';
import { isNotFound, useClaimPreview } from './queries';

export const CLAIM_UNUSABLE_TITLE = "This claim link can't be used";
export const CLAIM_LOAD_FAILED_TEXT = "Couldn't load this claim link.";

export function formatDate(iso: string): string {
  return dayjs(iso).format('MMM D, YYYY');
}

export function UnusableLink({ title, message }: { title: string; message: string }) {
  return (
    <EmptyState title={title} actionTitle="Go to Sharkulator" onAction={() => router.replace('/')}>
      <Text style={styles.centeredText}>{message}</Text>
    </EmptyState>
  );
}

function PlayerSummary({ preview }: { preview: ClaimPreview }) {
  const { player, invitedBy } = preview;
  return (
    <View style={styles.card} testID="claim-player">
      <Text style={styles.name}>{displayName(player)}</Text>
      <Text style={styles.username}>@{player.username}</Text>
      <UnclaimedBadge />
      {invitedBy && <Text style={styles.caption}>Added by {displayName(invitedBy)}</Text>}
      <Text style={styles.games} testID="claim-games-count">
        {preview.gamesCount} {preview.gamesCount === 1 ? 'game' : 'games'} played
      </Text>
      {preview.stats.map((s) => (
        <View key={s.id} style={styles.statRow} testID={`claim-stats-${s.tournament.name}`}>
          <Text style={styles.statName}>{s.tournament.displayName}</Text>
          <Text style={styles.statValue}>
            {formatPoints(s.score)} pts · {s.winCount}W {s.loseCount}L
          </Text>
        </View>
      ))}
    </View>
  );
}

function ClaimActions({ target }: { target: ClaimTarget }) {
  const { session, user, logout } = useSession();
  const google = useClaimSignIn(target);
  const [signingOut, setSigningOut] = useState(false);

  if (google.claimed && session) return <Redirect href="/feed" />;

  if (session && !google.claimed) {
    const onSignOut = async () => {
      setSigningOut(true);
      try {
        await logout();
      } finally {
        setSigningOut(false);
      }
    };
    return (
      <View style={styles.card} testID="claim-signed-in">
        <Text style={Typography.body}>
          You are signed in as @{user?.username}. That account cannot claim this player. Sign out,
          then claim it with a Google account that has never been used with Sharkulator.
        </Text>
        <Button title="Sign out" loading={signingOut} onPress={() => void onSignOut()} />
      </View>
    );
  }

  return (
    <View style={styles.actions}>
      <Button
        title={google.status === 'pending' ? 'Claiming…' : 'Claim with Google'}
        testID="claim-with-google"
        loading={google.status === 'pending'}
        disabled={!google.ready}
        onPress={() => void google.signIn()}
      />
      {!google.configured && (
        <Text style={styles.caption}>Google sign-in is not configured for this build.</Text>
      )}
      {google.status === 'error' && google.error && (
        <View style={styles.error} accessibilityRole="alert" testID="claim-error">
          <Text style={styles.errorText}>{google.error}</Text>
          <Button title="Try again" variant="secondary" onPress={() => void google.signIn()} />
        </View>
      )}
    </View>
  );
}

export function ClaimScreen({ token }: { token: string }) {
  const preview = useClaimPreview(token);

  if (preview.isPending) return <CenteredLoading />;
  if (preview.isError) {
    if (isNotFound(preview.error)) {
      return <UnusableLink title={CLAIM_UNUSABLE_TITLE} message={CLAIM_UNUSABLE_TEXT} />;
    }
    return (
      <EmptyState
        title={CLAIM_LOAD_FAILED_TEXT}
        actionTitle="Retry"
        onAction={() => void preview.refetch()}
      />
    );
  }

  const data = preview.data;
  const target: ClaimTarget = { token, playerName: displayName(data.player) };
  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Claim your Sharkulator profile</Text>
      <Text style={styles.centeredText}>
        Someone has been recording games for you. Claim this player to keep its games, ratings and
        rivalries under your own account.
      </Text>
      <OpenInApp url={claimInviteAppUrl(token)} />
      <PlayerSummary preview={data} />
      <View style={styles.notice} testID="claim-new-account-notice">
        <Text style={styles.noticeTitle}>Only a new account can claim</Text>
        <Text style={Typography.body}>{NEW_ACCOUNT_ONLY_TEXT}</Text>
      </View>
      <ClaimActions target={target} />
      <Text style={styles.caption}>This link expires on {formatDate(data.expiresAt)}.</Text>
      {data.recentGames.length > 0 && <SectionTitle title="RECENT GAMES" />}
      {data.recentGames.map((game) => (
        <GameRow key={game.id} game={game} expandable={false} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  title: { ...Typography.title, textAlign: 'center' },
  centeredText: { ...Typography.bodySecondary, textAlign: 'center' },
  card: { ...Palette.card, gap: Spacing.sm, alignItems: 'stretch' },
  name: { ...Typography.title, fontSize: 24, textAlign: 'center' },
  username: { ...Typography.bodySecondary, textAlign: 'center' },
  caption: { ...Typography.caption, textAlign: 'center' },
  games: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  statName: { ...Typography.body, flexShrink: 1 },
  statValue: { ...Typography.bodySecondary },
  notice: { ...Palette.card, borderColor: Colors.warning, gap: Spacing.xs },
  noticeTitle: { ...Typography.body, fontWeight: '700', color: Colors.warning },
  actions: { gap: Spacing.sm },
  error: { ...Palette.card, borderColor: Colors.error, gap: Spacing.sm },
  errorText: { ...Typography.body, color: Colors.errorText },
});
