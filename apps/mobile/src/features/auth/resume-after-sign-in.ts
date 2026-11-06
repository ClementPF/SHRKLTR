import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

export type ResumeAfterSignIn = (pathname: string, isCurrentAccount: () => boolean) => void;

/**
 * Calls `resume` once per signed-in account, after signing in has left /login through the index
 * redirect, so whatever it opens lands on top of the signed-in app. Signing out lets the next
 * sign-in, even by the same account, resume again.
 */
export function useResumeAfterSignIn(
  ready: boolean,
  accountKey: string | null,
  resume: ResumeAfterSignIn,
) {
  const pathname = usePathname();
  const handled = useRef<string | null>(null);
  const currentAccount = useRef(accountKey);
  currentAccount.current = accountKey;
  const latestResume = useRef(resume);
  latestResume.current = resume;
  const settling = pathname === '/' || pathname === '/login';

  useEffect(() => {
    if (!accountKey) {
      handled.current = null;
      return;
    }
    if (!ready || settling || handled.current === accountKey) return;
    handled.current = accountKey;
    latestResume.current(pathname, () => currentAccount.current === accountKey);
  }, [ready, accountKey, settling, pathname]);
}
