import type { ShareParticipant, ShareSnapshot } from './share-snapshot.js';

/** Same format as the app: sign and one decimal, e.g. +16.0 / -16.0. */
export function signedElo(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function formatShareDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function teamTitle(result: ShareParticipant['result'], size: number): string {
  if (result === 'TIE') return 'Draw';
  const word = result === 'WIN' ? 'Winner' : 'Loser';
  return size === 1 ? word : `${word}s`;
}

/** "Alice", "Alice & Bob" or "Alice, Bob +3" for larger teams. */
export function teamLabel(players: readonly ShareParticipant[]): string {
  const names = players.map((p) => p.displayName);
  if (names.length <= 2) return names.join(' & ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

/** Preview title, e.g. "Alice beat Bob · Table Tennis". */
export function shareTitle(snapshot: ShareSnapshot): string {
  const winners = snapshot.participants.filter((p) => p.result === 'WIN');
  const losers = snapshot.participants.filter((p) => p.result === 'LOSS');
  const headline =
    winners.length > 0 && losers.length > 0
      ? `${teamLabel(winners)} beat ${teamLabel(losers)}`
      : `${teamLabel(snapshot.participants)} drew`;
  return `${headline} · ${snapshot.sport}`;
}

const DESCRIPTION_PLAYERS = 6;

/** Preview description: signed Elo changes, tournament and date. */
export function shareDescription(snapshot: ShareSnapshot): string {
  const listed = snapshot.participants
    .slice(0, DESCRIPTION_PLAYERS)
    .map((p) => `${p.displayName} ${signedElo(p.eloDelta)}`);
  const more = snapshot.participants.length - DESCRIPTION_PLAYERS;
  if (more > 0) listed.push(`+${more} more`);
  return `Elo: ${listed.join(', ')} · ${snapshot.tournament} · ${formatShareDate(snapshot.date)}`;
}
