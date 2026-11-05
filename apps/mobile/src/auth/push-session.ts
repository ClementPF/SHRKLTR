import type { DevicePushToken, PushRegistrationOptions } from '@/notifications/push-types';

export type RegisterPush = (options?: PushRegistrationOptions) => Promise<string | null>;
export type WatchPushToken = (onChange: (token: DevicePushToken) => void) => () => void;

/** Push registration for one signed-in session: registers now and again on every token rotation. */
export interface PushSession {
  /**
   * Stops watching for rotation and cancels every registration that has not started its server
   * write. Resolves once the writes already sent have settled. Safe to call more than once.
   */
  stop(): Promise<void>;
}

export function startPushSession(
  registerPush: RegisterPush,
  watchPushToken: WatchPushToken,
): PushSession {
  const controller = new AbortController();
  const inFlight = new Set<Promise<void>>();
  let stopped: Promise<void> | null = null;

  const register = (devicePushToken?: DevicePushToken) => {
    if (controller.signal.aborted) return;
    const { signal } = controller;
    const run = registerPush(devicePushToken ? { devicePushToken, signal } : { signal }).then(
      () => undefined,
      (err: unknown) => {
        console.warn('Push registration failed', err);
      },
    );
    inFlight.add(run);
    void run.then(() => inFlight.delete(run));
  };

  const unwatch = watchPushToken(register);
  register();

  return {
    stop() {
      if (!stopped) {
        controller.abort();
        unwatch();
        stopped = Promise.all(inFlight).then(() => undefined);
      }
      return stopped;
    },
  };
}
