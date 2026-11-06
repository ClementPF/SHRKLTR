import { open, mkdir, unlink } from 'node:fs/promises';
import { CONTROL_URL } from '../apps/backend/e2e/environment.js';

export default async function setup() {
  const status = await fetch(`${CONTROL_URL}/ready`).then((r) => r.json());
  if (status.harness !== 'sharkulator-e2e-v1' || !status.ready) {
    throw new Error('Refusing to use an unknown E2E server');
  }
  await mkdir('.e2e', { recursive: true });
  const path = '.e2e/run.lock';
  const lock = await open(path, 'wx').catch(() => {
    throw new Error(
      'Another E2E run owns .e2e/run.lock. If it crashed, confirm it stopped before removing that file.',
    );
  });
  await lock.writeFile(String(process.pid));
  await lock.close();
  return async () => {
    await unlink(path);
  };
}
