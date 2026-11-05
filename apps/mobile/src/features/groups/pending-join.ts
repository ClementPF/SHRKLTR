import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { clearPendingClaim } from '@/auth/pending-claim';
import { readPendingJoin, savePendingJoin, type PendingJoinInput } from '@/auth/pending-join';
import { ORDINARY_SIGN_IN_MODE } from '@/features/auth/login-screen';

const ignore = () => undefined;

/** Accepts what people type: any case, spaces or dashes between characters. */
export function normalizeInviteCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * Leaves for sign-in with the invitation kept as a pending join. Joining a group is never a
 * claim, so a claim left pending is dropped and the login screen signs in normally.
 */
export async function signInToJoin(join: PendingJoinInput) {
  await savePendingJoin(join).catch(ignore);
  await clearPendingClaim().catch(ignore);
  router.push({ pathname: '/login', params: { mode: ORDINARY_SIGN_IN_MODE } });
}

/**
 * After sign-in, reopens a pending group invitation so the user can confirm or cancel it. Runs
 * once per signed-in account; the join itself always waits for that explicit confirmation.
 */
export function usePendingJoinResume(ready: boolean, accountKey: string | null) {
  const pathname = usePathname();
  const handled = useRef<string | null>(null);
  const currentAccount = useRef(accountKey);
  currentAccount.current = accountKey;
  // Signing in leaves /login through the index redirect; resuming waits until that settled.
  const settling = pathname === '/' || pathname === '/login';
  const onJoinScreen = pathname === '/join' || pathname.startsWith('/join/');

  useEffect(() => {
    if (!accountKey) {
      // Signing out lets the next sign-in, even by the same account, resume again.
      handled.current = null;
      return;
    }
    if (!ready || settling || handled.current === accountKey) return;
    handled.current = accountKey;
    if (onJoinScreen) return;
    void readPendingJoin()
      .catch(() => null)
      .then((join) => {
        if (!join || currentAccount.current !== accountKey) return;
        if ('token' in join) {
          router.push({ pathname: '/join/[token]', params: { token: join.token } });
        } else {
          router.push('/join');
        }
      });
  }, [ready, accountKey, settling, onJoinScreen]);
}
