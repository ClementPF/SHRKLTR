import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { prepareDatabase } from './database.js';
import { API_URL, CONTROL_URL, WEB_URL, DEV_AUTH, backendEnv } from './environment.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const started = performance.now();
const children: ChildProcess[] = [];
let stopping = false;
let ready = false;
const controller = new AbortController();

async function healthy(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function requireFreePort(port: number) {
  const occupied = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
  if (occupied) throw new Error(`E2E port ${port} is occupied. Do not stop an unrelated server.`);
}

// Expo's CI mode disables Metro file watching, so a reused server would serve stale app code.
function withoutCi(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy.CI;
  return copy;
}

function launch(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.once('error', (err) => {
    console.error(err);
    void stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) void stop(code || 1);
  });
}

const control = createServer(async (req, res) => {
  if (req.url !== '/ready') {
    res.writeHead(404).end();
    return;
  }
  const live =
    ready && (await healthy(`${API_URL}/health`)) && (await healthy(`${WEB_URL}/status`));
  res.writeHead(live ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ harness: 'sharkulator-e2e-v1', ready: live, pid: process.pid }));
});

async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  controller.abort();
  control.close();
  const exited = children.map(
    (child) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  );
  const killTimer = setTimeout(() => children.forEach((child) => child.kill('SIGKILL')), 5000);
  await Promise.all(exited);
  clearTimeout(killTimer);
  process.exit(code);
}
process.once('SIGINT', () => void stop(0));
process.once('SIGTERM', () => void stop(0));

async function waitFor(url: string) {
  const deadline = performance.now() + 180_000;
  while (!(await healthy(url))) {
    if (performance.now() > deadline) throw new Error(`Not ready after 180s: ${url}`);
    await delay(200, undefined, { signal: controller.signal });
  }
}

try {
  for (const port of [3191, 3192, 8091]) await requireFreePort(port);
  await prepareDatabase();
  launch(['--import', 'tsx', '--watch', 'src/server.ts'], resolve(root, 'apps/backend'), {
    ...process.env,
    ...backendEnv,
  });
  launch(
    [resolve(root, 'node_modules/expo/bin/cli'), 'start', '--web', '--offline', '--port', '8091'],
    resolve(root, 'apps/mobile'),
    {
      ...withoutCi(process.env),
      EXPO_NO_DOTENV: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_PUBLIC_API_URL: API_URL,
      EXPO_PUBLIC_ENV: 'development',
      EXPO_PUBLIC_DEV_AUTH: DEV_AUTH,
      EXPO_PUBLIC_GOOGLE_CLIENT_ID: '',
    },
  );
  await Promise.all([waitFor(`${API_URL}/health`), waitFor(`${WEB_URL}/status`)]);
  const warmStarted = performance.now();
  const html = await fetch(`${WEB_URL}/login`, { signal: AbortSignal.timeout(180_000) });
  if (!html.ok) throw new Error(`Web warmup failed: ${html.status}`);
  const scripts = [...(await html.text()).matchAll(/<script[^>]+src="([^"]+)"/g)];
  if (!scripts.length) throw new Error('Web warmup found no bundle scripts');
  for (const [, src] of scripts) {
    const url = new URL(src.replaceAll('&amp;', '&'), WEB_URL);
    if (url.origin !== WEB_URL) throw new Error('Unexpected external warmup script');
    const bundle = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!bundle.ok) throw new Error(`Bundle warmup failed: ${bundle.status}`);
    await bundle.arrayBuffer();
  }
  ready = true;
  control.listen(3192, '127.0.0.1');
  console.log(
    `E2E ready at ${CONTROL_URL}/ready; startup ${(performance.now() - started).toFixed(0)}ms; bundle warmup ${(performance.now() - warmStarted).toFixed(0)}ms`,
  );
} catch (err) {
  console.error(err);
  await stop(1);
}
