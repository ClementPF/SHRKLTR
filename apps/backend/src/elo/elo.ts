export const K_FACTOR = 32;
export const DEFAULT_RATING = 1000;

export type EloResult = 'WIN' | 'LOSS';

export interface EloOutcome {
  username: string;
  result: EloResult;
}

export type Ratings = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

function ratingOf(ratings: Ratings, username: string): number {
  const rating =
    ratings instanceof Map
      ? ratings.get(username)
      : Object.hasOwn(ratings, username)
        ? (ratings as Readonly<Record<string, number>>)[username]
        : undefined;
  return rating ?? DEFAULT_RATING;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Rating change per participant for one game. Players missing from `ratings` start at
 * DEFAULT_RATING. Every winner gains the full delta and every loser loses it — deliberately
 * not divided by team size and never rounded, matching the legacy engine.
 */
export function computeDeltas(
  outcomes: readonly EloOutcome[],
  ratings: Ratings,
): Map<string, number> {
  const winners = outcomes.filter((outcome) => outcome.result === 'WIN');
  const losers = outcomes.filter((outcome) => outcome.result === 'LOSS');
  if (winners.length === 0 || losers.length === 0) {
    throw new Error('Elo requires at least one winner and one loser');
  }

  const winnerRating = mean(winners.map((outcome) => ratingOf(ratings, outcome.username)));
  const loserRating = mean(losers.map((outcome) => ratingOf(ratings, outcome.username)));
  const expectedWin = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
  const delta = K_FACTOR * (1 - expectedWin);

  const deltas = new Map<string, number>();
  for (const outcome of outcomes) {
    deltas.set(outcome.username, outcome.result === 'WIN' ? delta : -delta);
  }
  return deltas;
}
