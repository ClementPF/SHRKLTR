import type { SubmitGameRequest } from '@/api/types';

/** Ties are not submittable, so a QR code only ever carries a decisive result. */
export type QrResult = 'WIN' | 'LOSS';

/** Payload format shared with the legacy app, so old and new clients can scan each other. */
export interface QrPayload {
  username: string;
  tournamentName: string;
  tournament: { name: string };
  result: QrResult;
}

export interface ScannedOutcome {
  username: string;
  result: QrResult;
}

export const REQUIRED_KEYS = ['username', 'result', 'tournamentName'] as const;

export const INVALID_QR_MESSAGE = `It does not appear to be a valid QR code for the SHARKULATOR (expected ${REQUIRED_KEYS.join(', ')}).`;
export const WRONG_TOURNAMENT_MESSAGE =
  "It looks like you haven't selected the same tournament, get your fishes together guys!";

export function buildQrPayload(
  username: string,
  tournamentName: string,
  result: QrResult,
): QrPayload {
  return { username, tournamentName, tournament: { name: tournamentName }, result };
}

export function encodeQrPayload(payload: QrPayload): string {
  return JSON.stringify(buildQrPayload(payload.username, payload.tournamentName, payload.result));
}

export type ParseResult = { ok: true; payload: QrPayload } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function parseQrPayload(raw: string): ParseResult {
  const invalid: ParseResult = { ok: false, error: INVALID_QR_MESSAGE };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return invalid;
  }
  if (!isRecord(data) || !REQUIRED_KEYS.every((key) => key in data)) return invalid;
  const { username, tournamentName, result, tournament } = data;
  if (!isNonEmptyString(username) || !isNonEmptyString(tournamentName)) return invalid;
  if (result !== 'WIN' && result !== 'LOSS') return invalid;
  let nestedName = tournamentName;
  if (tournament !== undefined) {
    if (!isRecord(tournament) || !isNonEmptyString(tournament.name)) return invalid;
    nestedName = tournament.name;
  }
  return {
    ok: true,
    payload: { username, tournamentName, tournament: { name: nestedName }, result },
  };
}

/** The scanning player always lost: they are the one submitting the game. */
export function seedOutcomes(username: string): ScannedOutcome[] {
  return [{ username, result: 'LOSS' }];
}

export type ScanResult =
  | { status: 'added'; added: ScannedOutcome; outcomes: ScannedOutcome[] }
  | { status: 'duplicate'; outcomes: ScannedOutcome[] }
  | { status: 'invalid' | 'wrong-tournament'; error: string; outcomes: ScannedOutcome[] };

/** Adds one scanned code to the outcomes; rejected or repeated codes leave them untouched. */
export function applyScan(
  outcomes: ScannedOutcome[],
  raw: string,
  tournamentName: string,
): ScanResult {
  const parsed = parseQrPayload(raw);
  if (!parsed.ok) return { status: 'invalid', error: parsed.error, outcomes };
  const { payload } = parsed;
  if (payload.tournamentName !== tournamentName || payload.tournament.name !== tournamentName) {
    return { status: 'wrong-tournament', error: WRONG_TOURNAMENT_MESSAGE, outcomes };
  }
  if (outcomes.some((o) => o.username === payload.username)) {
    return { status: 'duplicate', outcomes };
  }
  const added: ScannedOutcome = { username: payload.username, result: payload.result };
  return { status: 'added', added, outcomes: [...outcomes, added] };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Why the outcomes cannot be submitted yet, or null once the confirmation may be shown. */
export function submissionBlocker(outcomes: readonly ScannedOutcome[]): string | null {
  const winners = outcomes.filter((o) => o.result === 'WIN').length;
  const losers = outcomes.length - winners;
  if (winners === 0) return "Scan the winner's QR code before submitting.";
  if (winners !== losers) {
    return `Teams must have the same size (${plural(winners, 'winner')} vs ${plural(losers, 'loser')}). Scan the missing players.`;
  }
  return null;
}

export function toSubmitGameRequest(outcomes: readonly ScannedOutcome[]): SubmitGameRequest {
  return { outcomes: outcomes.map(({ username, result }) => ({ username, result })) };
}

export const SCAN_REPEAT_WINDOW_MS = 2000;

export interface LastScan {
  data: string;
  at: number;
}

/** The camera reports the same code on every frame while it stays in view. */
export function isRepeatedScan(
  last: LastScan | null,
  data: string,
  now: number,
  windowMs: number = SCAN_REPEAT_WINDOW_MS,
): boolean {
  return last !== null && last.data === data && now - last.at <= windowMs;
}
