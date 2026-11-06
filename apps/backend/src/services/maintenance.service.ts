import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { sweepChallenges, type SweepResult } from './challenge.service.js';
import type { PushNotifier } from './push.service.js';

export const MAINTENANCE_INTERVAL_MS = 60_000;

export interface Maintenance {
  /** Runs a catch-up sweep now, then one every interval. Calling it twice has no effect. */
  start(): void;
  /** Clears the interval and waits for a sweep still running. */
  stop(): Promise<void>;
  /** One sweep at the current clock, unless one is already running (then it waits for that one). */
  runOnce(): Promise<void>;
}

export interface MaintenanceDeps {
  db: Database;
  push: Pick<PushNotifier, 'dispatch'>;
  clock: () => Date;
  log: FastifyBaseLogger;
  intervalMs?: number;
  /** Defaults to sweepChallenges; tests substitute a controllable sweep. */
  sweep?: (db: Database, now: Date) => Promise<SweepResult>;
}

/**
 * In-process challenge deadline maintenance (expiry and 24-hour reminders). A tick that fires
 * while the previous sweep is still running is skipped, so sweeps never overlap locally.
 */
export function createMaintenance(deps: MaintenanceDeps): Maintenance {
  const sweep = deps.sweep ?? sweepChallenges;
  const intervalMs = deps.intervalMs ?? MAINTENANCE_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;

  async function run(): Promise<void> {
    try {
      const result = await sweep(deps.db, deps.clock());
      deps.push.dispatch(result.notificationIds);
      if (result.expired > 0 || result.reminded > 0) {
        deps.log.info(
          { expired: result.expired, reminded: result.reminded },
          'challenge sweep finished',
        );
      }
    } catch (err) {
      deps.log.error(
        { reason: err instanceof Error ? err.message : 'unknown' },
        'challenge sweep failed',
      );
    }
  }

  function trigger(): Promise<void> {
    if (running) return running;
    const current = run().finally(() => {
      running = null;
    });
    running = current;
    return current;
  }

  return {
    start() {
      if (timer || stopped) return;
      void trigger();
      timer = setInterval(() => {
        if (!running) void trigger();
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (running) await running;
    },
    runOnce: trigger,
  };
}
