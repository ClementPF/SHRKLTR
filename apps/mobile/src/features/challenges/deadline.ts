export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export const MIN_DEADLINE_MS = HOUR_MS;
export const MAX_DEADLINE_MS = 30 * DAY_MS;
export const DEFAULT_DEADLINE_MS = 7 * DAY_MS;

/**
 * The server checks the range against its own clock when the request arrives, so a deadline
 * sitting exactly on a bound would fail by the request's latency or a small clock difference.
 */
const BOUND_MARGIN_MS = 60_000;

export const DEADLINE_MALFORMED_TEXT = 'Enter the deadline as a whole number of hours or days.';
export const DEADLINE_TOO_SOON_TEXT = 'The deadline must be at least 1 hour away.';
export const DEADLINE_TOO_LATE_TEXT = 'The deadline can be at most 30 days away.';

export type DeadlineUnit = 'hours' | 'days';

export interface DeadlinePreset {
  key: string;
  label: string;
  durationMs: number;
}

export const DEADLINE_PRESETS: readonly DeadlinePreset[] = [
  { key: '1h', label: '1 hour', durationMs: HOUR_MS },
  { key: '1d', label: '1 day', durationMs: DAY_MS },
  { key: '3d', label: '3 days', durationMs: 3 * DAY_MS },
  { key: '7d', label: '7 days', durationMs: DEFAULT_DEADLINE_MS },
  { key: '14d', label: '14 days', durationMs: 14 * DAY_MS },
  { key: '30d', label: '30 days', durationMs: MAX_DEADLINE_MS },
];

export const DEFAULT_PRESET_KEY = '7d';

/** A custom "in N hours/days" duration, or null when the amount is not a whole number. */
export function parseDuration(amount: string, unit: DeadlineUnit): number | null {
  const trimmed = amount.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed) * (unit === 'hours' ? HOUR_MS : DAY_MS);
}

/** Why this duration cannot be a challenge deadline (1 hour to 30 days, inclusive), or null. */
export function deadlineProblem(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs)) return DEADLINE_MALFORMED_TEXT;
  if (durationMs < MIN_DEADLINE_MS) return DEADLINE_TOO_SOON_TEXT;
  if (durationMs > MAX_DEADLINE_MS) return DEADLINE_TOO_LATE_TEXT;
  return null;
}

/**
 * The `deadlineAt` to send for a valid duration: omitted for the default, which the server
 * computes from its own clock.
 */
export function deadlineAtFor(durationMs: number, now: Date): string | undefined {
  if (durationMs === DEFAULT_DEADLINE_MS) return undefined;
  const clamped = Math.min(
    Math.max(durationMs, MIN_DEADLINE_MS + BOUND_MARGIN_MS),
    MAX_DEADLINE_MS - BOUND_MARGIN_MS,
  );
  return new Date(now.getTime() + clamped).toISOString();
}
