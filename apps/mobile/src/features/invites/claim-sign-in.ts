import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/errors';
import type { GoogleCodeExchangeRequest } from '@/api/types';
import { useGoogleSignIn, type GoogleSignIn } from '@/auth/google';
import {
  clearPendingClaim,
  readPendingClaim,
  savePendingClaim,
  type PendingClaim,
} from '@/auth/pending-claim';
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

/**
 * Google sign-in that claims `target` when given one: the claim is recorded as a pending intent
 * before leaving for Google (so it survives a reload or app restart) and its token is sent with
 * the code exchange. Without a target this is the ordinary sign-in and sends no claim token.
 */
export function useClaimSignIn(target: ClaimTarget | null): ClaimSignIn {
  const { loginWithGoogleCode } = useSession();
  const [claimed, setClaimed] = useState(false);
  const token = target?.token ?? null;
  const playerName = target?.playerName ?? '';

  const onCode = useCallback(
    async (exchange: GoogleCodeExchangeRequest) => {
      if (!token) {
        await loginWithGoogleCode(exchange);
        return;
      }
      try {
        await loginWithGoogleCode({ ...exchange, claimToken: token });
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
    [token, loginWithGoogleCode],
  );

  const google = useGoogleSignIn(onCode);
  const startGoogle = google.signIn;
  const signIn = useCallback(async () => {
    // Not awaited: the Google popup must open within the click's user activation on web.
    if (token) void savePendingClaim({ token, playerName }).catch(ignore);
    await startGoogle();
  }, [token, playerName, startGoogle]);

  return { ...google, signIn, claimed };
}

/**
 * The claim left pending by an interrupted sign-in, with a way to abandon it. Disabled, it never
 * reads the stored claim (and so never resumes it).
 */
export function usePendingClaim(enabled = true) {
  const [pending, setPending] = useState<PendingClaim | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    readPendingClaim()
      .then((claim) => {
        if (active) setPending(claim);
      })
      .catch(ignore);
    return () => {
      active = false;
    };
  }, [enabled]);

  const discard = useCallback(() => {
    setPending(null);
    void clearPendingClaim().catch(ignore);
  }, []);

  return { pending, discard };
}
