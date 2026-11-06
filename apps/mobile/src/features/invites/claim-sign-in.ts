import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api/errors';
import type { GoogleCodeExchangeRequest } from '@/api/types';
import { useGoogleSignIn, type GoogleSignIn } from '@/auth/google';
import {
  clearPendingClaim,
  readPendingClaim,
  savePendingClaim,
  type PendingClaim,
} from '@/auth/pending-claim';
import { clearPendingReturn } from '@/auth/pending-return';
import { useSession } from '@/auth/session';

export const CLAIM_REQUIRES_NEW_ACCOUNT = 'CLAIM_REQUIRES_NEW_ACCOUNT';
export const CLAIM_INVALID = 'CLAIM_INVALID';

export const NEW_ACCOUNT_ONLY_TEXT =
  'Only a new account can claim this player: use a Google account that has never been used to sign in to Sharkulator. An existing Sharkulator account cannot claim it, and accounts are never merged.';
export const EXISTING_ACCOUNT_TEXT =
  'This Google account already has a Sharkulator profile, so it cannot claim this player. Nothing was changed. Try again with a Google account that has never been used with Sharkulator.';
export const CLAIM_UNUSABLE_TEXT =
  "This claim link can't be used. It may have expired, been revoked or already been used. Ask the person who added you for a new link.";

export function claimFailureMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === CLAIM_REQUIRES_NEW_ACCOUNT) return EXISTING_ACCOUNT_TEXT;
    if (err.code === CLAIM_INVALID) return CLAIM_UNUSABLE_TEXT;
  }
  return err instanceof Error && err.message ? err.message : 'Claiming failed. Try again.';
}

export interface ClaimTarget {
  token: string;
  playerName: string;
}

export interface ClaimSignIn extends GoogleSignIn {
  /** True once a claim exchange succeeded in this hook. */
  claimed: boolean;
}

const ignore = () => undefined;

function isPendingClaimState(
  target: ClaimTarget | PendingClaimState | null,
): target is PendingClaimState {
  return target !== null && 'resolve' in target;
}

/**
 * Google sign-in that claims `target` when given one: the claim is recorded as a pending intent
 * before leaving for Google (so it survives a reload or app restart) and its token is sent with
 * the code exchange. Without a target this is the ordinary sign-in and sends no claim token.
 *
 * Given a stored pending claim (`usePendingClaim`), sign-in stays unavailable until the stored
 * claim has been read, and a Google result that arrives earlier waits for that read before the
 * code is exchanged, so a resumed claim is never downgraded to an ordinary sign-in.
 */
export function useClaimSignIn(target: ClaimTarget | PendingClaimState | null): ClaimSignIn {
  const { loginWithGoogleCode } = useSession();
  const [claimed, setClaimed] = useState(false);
  const stored = isPendingClaimState(target) ? target : null;
  const current = stored ? stored.pending : (target as ClaimTarget | null);
  const hydrated = stored ? stored.hydrated : true;
  const resolveStored = stored?.resolve;
  const token = current?.token ?? null;
  const playerName = current?.playerName ?? '';

  const onCode = useCallback(
    async (exchange: GoogleCodeExchangeRequest) => {
      const claimToken = resolveStored ? ((await resolveStored())?.token ?? null) : token;
      if (!claimToken) {
        await loginWithGoogleCode(exchange);
        return;
      }
      try {
        await loginWithGoogleCode({ ...exchange, claimToken });
      } catch (err) {
        // A dead link cannot be resumed; any other failure keeps the claim for a retry.
        if (err instanceof ApiError && err.code === CLAIM_INVALID) {
          await clearPendingClaim().catch(ignore);
        }
        throw new Error(claimFailureMessage(err), { cause: err });
      }
      await clearPendingClaim().catch(ignore);
      setClaimed(true);
    },
    [token, resolveStored, loginWithGoogleCode],
  );

  const google = useGoogleSignIn(onCode);
  const startGoogle = google.signIn;
  const signIn = useCallback(async () => {
    if (!hydrated) return;
    // Not awaited: the Google popup must open within the click's user activation on web.
    if (token) {
      void savePendingClaim({ token, playerName }).catch(ignore);
      // The claim is what this sign-in resumes, not a screen opened earlier.
      void clearPendingReturn().catch(ignore);
    }
    await startGoogle();
  }, [hydrated, token, playerName, startGoogle]);

  return { ...google, ready: google.ready && hydrated, signIn, claimed };
}

export interface PendingClaimState {
  /** The stored claim once read; null while reading, when there is none, or when disabled. */
  pending: PendingClaim | null;
  /** False until the stored claim has been read. Always true when disabled. */
  hydrated: boolean;
  /** The current claim, waiting for the storage read if it is still in flight. */
  resolve(): Promise<PendingClaim | null>;
  /** Abandons the claim. */
  discard(): void;
}

/**
 * The claim left pending by an interrupted sign-in, with a way to abandon it. Disabled, it never
 * reads the stored claim (and so never resumes it).
 */
export function usePendingClaim(enabled = true): PendingClaimState {
  const [pending, setPending] = useState<PendingClaim | null>(null);
  const [readDone, setReadDone] = useState(false);
  const latest = useRef<PendingClaim | null>(null);
  const reading = useRef<Promise<void> | null>(null);

  const hydrate = useCallback(() => {
    reading.current ??= readPendingClaim()
      .catch(() => null)
      .then((claim) => {
        latest.current = claim;
        setPending(claim);
        setReadDone(true);
      });
    return reading.current;
  }, []);

  useEffect(() => {
    if (enabled) void hydrate();
  }, [enabled, hydrate]);

  const resolve = useCallback(async () => {
    if (!enabled) return null;
    await hydrate();
    return latest.current;
  }, [enabled, hydrate]);

  const discard = useCallback(() => {
    latest.current = null;
    setPending(null);
    void clearPendingClaim().catch(ignore);
  }, []);

  return {
    pending: enabled ? pending : null,
    hydrated: !enabled || readDone,
    resolve,
    discard,
  };
}
