import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { readPendingClaim } from '@/auth/pending-claim';
import { readPendingJoin } from '@/auth/pending-join';
import {
  returnDestinationFromPath,
  savePendingReturn,
  takePendingReturn,
} from '@/auth/pending-return';

import { useResumeAfterSignIn } from './resume-after-sign-in';

const none = () => null;

/** A claim or group invitation waiting for sign-in has priority over a plain destination. */
async function hasPriorityIntent(): Promise<boolean> {
  const [claim, join] = await Promise.all([
    readPendingClaim().catch(none),
    readPendingJoin().catch(none),
  ]);
  return claim !== null || join !== null;
}

async function keepDestination(path: string) {
  if (await hasPriorityIntent()) return;
  await savePendingReturn(path);
}

/**
 * While signed out, remembers an allowlisted signed-in screen the app was opened at (a shared
 * game link, a reload), which the protected navigator then replaces with sign-in.
 */
export function usePendingReturnCapture(signedIn: boolean) {
  const pathname = usePathname();
  // Signing out on a game screen leaves that screen as the route the guard redirects from;
  // it is where the user was, not a link they followed, so it is never kept.
  const signedInPath = useRef<string | null>(null);

  useEffect(() => {
    if (signedIn) {
      signedInPath.current = pathname;
      return;
    }
    if (pathname === signedInPath.current) return;
    signedInPath.current = null;
    if (returnDestinationFromPath(pathname)) void keepDestination(pathname).catch(none);
  }, [signedIn, pathname]);
}

async function openPendingReturn(isCurrentAccount: () => boolean) {
  const destination = await takePendingReturn().catch(none);
  if (!destination || !isCurrentAccount() || (await hasPriorityIntent())) return;
  router.push(destination);
}

/** After sign-in, opens the destination kept by `usePendingReturnCapture`, once. */
export function usePendingReturnResume(ready: boolean, accountKey: string | null) {
  useResumeAfterSignIn(ready, accountKey, (_pathname, isCurrentAccount) => {
    void openPendingReturn(isCurrentAccount);
  });
}
