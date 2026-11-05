import { z } from 'zod';

/** Version of the snapshot shape stored in game_shares.snapshot. */
export const SHARE_SNAPSHOT_VERSION = 1;

/** Longest label (name, sport, tournament) kept in a snapshot, in code points. */
export const SHARE_LABEL_MAX = 100;

const label = z.string().max(SHARE_LABEL_MAX * 2);

export const shareParticipantSchema = z.object({
  username: label,
  displayName: label,
  result: z.enum(['WIN', 'TIE', 'LOSS']),
  /** Signed Elo change from the game. */
  eloDelta: z.number(),
  /** Tournament rating just before the game; null for games recorded before tracking. */
  ratingBefore: z.number().nullable(),
});

/**
 * The only data a public share exposes: no emails, group identity, members, stats or claim state.
 * Fixed when the share is issued, so later profile or tournament edits never change it.
 */
export const shareSnapshotSchema = z.object({
  version: z.literal(SHARE_SNAPSHOT_VERSION),
  gameId: z.uuid(),
  date: z.iso.datetime(),
  sport: label,
  tournament: label,
  participants: z.array(shareParticipantSchema).min(1).max(200),
});

export type ShareSnapshot = z.infer<typeof shareSnapshotSchema>;
export type ShareParticipant = z.infer<typeof shareParticipantSchema>;

/** Cuts a label to SHARE_LABEL_MAX code points (never splitting a surrogate pair). */
export function boundLabel(value: string): string {
  const chars = Array.from(value.trim());
  return chars.length <= SHARE_LABEL_MAX
    ? chars.join('')
    : `${chars.slice(0, SHARE_LABEL_MAX - 1).join('')}…`;
}
