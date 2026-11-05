import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { submitGame } from '@/api/endpoints';
import { achievementKeys } from '@/features/achievements/queries';
import { gameKeys } from '@/features/games/queries';
import { notificationKeys } from '@/features/notifications/queries';
import { tournamentKeys } from '@/features/tournaments/queries';
import { FEED_PAGE_SIZE, statsKeys, userKeys, useUserGames } from '@/features/users/queries';
import { toSubmitGameRequest, type ScannedOutcome } from '@/lib/qr';

import { useGameFormStore } from './store';

export interface SubmitGameInput {
  tournamentName: string;
  outcomes: readonly ScannedOutcome[];
}

export function useSubmitGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tournamentName, outcomes }: SubmitGameInput) =>
      submitGame(tournamentName, toSubmitGameRequest(outcomes)),
    onSuccess: (game) => {
      // Pre-fills the durable game detail so the result opens instantly.
      queryClient.setQueryData(gameKeys.detail(game.id), game);
      // Not awaited: the result screen should open while the mounted feed/history refetch.
      for (const queryKey of [
        userKeys.all,
        statsKeys.all,
        tournamentKeys.all,
        notificationKeys.all,
        achievementKeys.all,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

/**
 * The draft tournament for the signed-in player, defaulting to the tournament of their latest
 * game (shares the feed's history query).
 */
export function useGameFormTournament(username: string | undefined) {
  const start = useGameFormStore((s) => s.start);
  const owner = useGameFormStore((s) => s.owner);
  const tournament = useGameFormStore((s) => s.tournament);
  const selectTournament = useGameFormStore((s) => s.selectTournament);
  const games = useUserGames(username, { pageSize: FEED_PAGE_SIZE });
  const latest = games.data?.pages[0]?.[0]?.tournament;
  const ready = !!username && owner === username;

  useEffect(() => {
    if (username) start(username);
  }, [start, username]);

  useEffect(() => {
    if (ready && !tournament && latest) selectTournament(latest);
  }, [ready, tournament, latest, selectTournament]);

  return {
    tournament: ready ? tournament : null,
    loading: !ready || (!tournament && games.isPending && !!username),
  };
}
