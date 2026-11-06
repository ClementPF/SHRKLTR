import { router } from 'expo-router';

import { clearPendingClaim } from '@/auth/pending-claim';
import { readPendingJoin, savePendingJoin, type PendingJoinInput } from '@/auth/pending-join';
import { clearPendingReturn } from '@/auth/pending-return';
import { ORDINARY_SIGN_IN_MODE } from '@/features/auth/login-screen';
import { useResumeAfterSignIn } from '@/features/auth/resume-after-sign-in';

const ignore = () => undefined;

/** Accepts what people type: any case, spaces or dashes between characters. */
export function normalizeInviteCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * Leaves for sign-in with the invitation kept as a pending join. Joining a group is never a
 * claim, so a claim left pending is dropped and the login screen signs in normally; an earlier
 * screen kept for after sign-in is dropped too, so the invitation is what sign-in resumes.
 */
export async function signInToJoin(join: PendingJoinInput) {
  await savePendingJoin(join).catch(ignore);
  await clearPendingClaim().catch(ignore);
  await clearPendingReturn().catch(ignore);
  router.push({ pathname: '/login', params: { mode: ORDINARY_SIGN_IN_MODE } });
}

/**
 * After sign-in, reopens a pending group invitation so the user can confirm or cancel it. Runs
 * once per signed-in account; the join itself always waits for that explicit confirmation.
 */
export function usePendingJoinResume(ready: boolean, accountKey: string | null) {
  useResumeAfterSignIn(ready, accountKey, (pathname, isCurrentAccount) => {
    if (pathname === '/join' || pathname.startsWith('/join/')) return;
    void readPendingJoin()
      .catch(() => null)
      .then((join) => {
        if (!join || !isCurrentAccount()) return;
        if ('token' in join) {
          router.push({ pathname: '/join/[token]', params: { token: join.token } });
        } else {
          router.push('/join');
        }
      });
  });
}
