import { CONTROL_URL } from './environment.js';

const status = await fetch(`${CONTROL_URL}/ready`, { signal: AbortSignal.timeout(3000) })
  .then((r) => r.json() as Promise<{ harness?: string; pid?: number }>)
  .catch(() => null);
if (!status) {
  console.log('No E2E server is running.');
} else if (status.harness !== 'sharkulator-e2e-v1' || typeof status.pid !== 'number') {
  throw new Error(`Refusing to stop an unknown server on ${CONTROL_URL}`);
} else {
  // The harness stops its API and Expo children on SIGTERM.
  process.kill(status.pid, 'SIGTERM');
  console.log(`Stopped the E2E server (pid ${status.pid}).`);
}
