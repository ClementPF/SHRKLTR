import type { FastifyBaseLogger } from 'fastify';
import type { GameWithRelations } from './game.service.js';
import { sendPush } from './push.service.js';

export const POSTGAME_TITLE = 'Well done Champ !';

export interface PostgameDeps {
  pushUrl: string;
  log: FastifyBaseLogger;
}

/**
 * Congratulates every winner holding a push token, naming the losers and the integer part of
 * the points won. Delivery failures are logged by sendPush and never reach the caller.
 */
export async function sendPostgamePushes(
  deps: PostgameDeps,
  game: GameWithRelations,
): Promise<void> {
  const losers = game.outcomes
    .filter((o) => o.outcome.result === 'LOSS')
    .map((o) => o.user.username);
  const winners = game.outcomes.filter((o) => o.outcome.result === 'WIN');

  await Promise.allSettled(
    winners.map(({ outcome, user }) => {
      if (!user.pushToken) return Promise.resolve(false);
      const points = Math.trunc(Math.abs(outcome.scoreValue));
      return sendPush(
        deps.pushUrl,
        {
          to: user.pushToken,
          title: POSTGAME_TITLE,
          body: `You just got ${points} points from ${losers.join(', ')}`,
          payload: {
            type: 'postgame',
            gameId: game.game.id,
            tournamentName: game.tournament.tournament.name,
          },
        },
        deps.log,
      );
    }),
  );
}
