import { act, render, screen } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform, Text } from 'react-native';

import { getMe, logoutSession, registerPushDevice, unregisterPushDevice } from '@/api/endpoints';
import type { RegisterPushDeviceRequest } from '@/api/types';
import { SessionProvider, useSession } from '@/auth/session';
import { createSessionStore } from '@/auth/session-store';
import { SESSION_STORAGE_KEY } from '@/auth/storage';
import {
  getOrCreateInstallationId,
  INSTALLATION_ID_KEY,
  readInstallationId,
  setInstallationIdStorage,
} from '@/notifications/installation-id';

import { deferred, makeSession, memoryStorage, testUser } from '../test-utils/session';

// Only external boundaries are mocked: SessionProvider, push-session, push-registration,
// installation-id and session-store run as in production.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addPushTokenListener: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { easConfig: { projectId: 'project-123' }, expoConfig: null },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@/api/endpoints', () => ({
  exchangeGoogleCode: jest.fn(),
  getMe: jest.fn(),
  logoutSession: jest.fn(),
  registerPushDevice: jest.fn(),
  unregisterPushDevice: jest.fn(),
}));
jest.mock('@/auth/devSession', () => ({ requestDevSession: jest.fn() }));

async function flushMicrotasks() {
  for (let n = 0; n < 100; n += 1) await Promise.resolve();
}

async function step(action: () => void = () => undefined) {
  await act(async () => {
    action();
    await flushMicrotasks();
  });
}

afterEach(() => {
  jest.clearAllMocks();
  setInstallationIdStorage(null);
});

describe('installation ID lifecycle', () => {
  it('sign-in registration and its iOS token event share one ID, so logout removes it', async () => {
    jest.useFakeTimers();
    const previousOS = Platform.OS;
    Platform.OS = 'ios';
    // The real SecureStore adapter, backed by slow asynchronous native calls.
    setInstallationIdStorage(null);
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      const events: string[] = [];
      const installationStorage = new Map<string, string>();
      const reads: (string | null)[] = [];
      const finishReads = deferred<void>();
      const writes: { value: string; finish: ReturnType<typeof deferred<void>> }[] = [];
      const posts: {
        input: RegisterPushDeviceRequest;
        finish: ReturnType<typeof deferred<void>>;
      }[] = [];
      const activeRows = new Map<string, string>([['other-installation', 'other-expo-token']]);

      jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
        const snapshot = installationStorage.get(key) ?? null;
        reads.push(snapshot);
        await finishReads.promise;
        return snapshot;
      });
      jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
        const write = { value, finish: deferred<void>() };
        writes.push(write);
        await write.finish.promise;
        installationStorage.set(key, value);
        events.push('persist');
      });

      let tokenListener: ((token: Notifications.DevicePushToken) => void) | undefined;
      const removeListener = jest.fn(() => events.push('watcher-stopped'));
      jest.mocked(Notifications.addPushTokenListener).mockImplementation((listener) => {
        tokenListener = listener;
        return { remove: removeListener };
      });
      jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
        status: 'granted',
      } as Notifications.NotificationPermissionsStatus);
      const nativeToken: Notifications.DevicePushToken = { type: 'ios', data: 'native-token' };
      jest.mocked(Notifications.getExpoPushTokenAsync).mockImplementation(async (options) => {
        if (!options?.devicePushToken) {
          // On iOS the first native token request also fires the token listener.
          events.push('initial-native-request');
          tokenListener!(nativeToken);
        } else {
          expect(options.devicePushToken).toEqual(nativeToken);
          events.push('supplied-token-exchange');
        }
        return { type: 'expo', data: 'ExponentPushToken[fake]' };
      });

      jest.mocked(getMe).mockResolvedValue(testUser);
      jest.mocked(registerPushDevice).mockImplementation(async (input) => {
        const post = { input, finish: deferred<void>() };
        posts.push(post);
        events.push('POST-sent');
        await post.finish.promise;
        // Mirrors the backend: a token has one owner, then upsert/reactivate this installation.
        for (const [id, token] of activeRows) {
          if (token === input.expoToken && id !== input.installationId) activeRows.delete(id);
        }
        activeRows.set(input.installationId, input.expoToken);
        events.push('POST-committed');
      });
      jest.mocked(unregisterPushDevice).mockImplementation(async (id) => {
        activeRows.delete(id);
        events.push('DELETE');
      });
      jest.mocked(logoutSession).mockImplementation(async () => {
        events.push('session-logout');
      });

      const { storage: sessionStorage, data: sessionData } = memoryStorage({
        [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()),
      });
      const store = createSessionStore(sessionStorage);
      let observed: ReturnType<typeof useSession> | undefined;
      function Probe() {
        observed = useSession();
        return <Text>{observed.status}</Text>;
      }
      view = await render(
        <SessionProvider store={store}>
          <Probe />
        </SessionProvider>,
      );
      await step();
      expect(screen.getByText('authenticated')).toBeTruthy();
      expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(2);
      expect(events.filter((event) => event === 'initial-native-request')).toHaveLength(1);
      expect(events).toContain('supplied-token-exchange');
      // Both registrations are waiting for the ID, but only one storage read is in flight.
      expect(reads).toEqual([null]);
      expect(writes).toHaveLength(0);

      await step(() => finishReads.resolve());
      expect(writes).toHaveLength(1);
      const id = writes[0]!.value;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      // Nothing is cached or posted before the ID is persisted.
      expect(posts).toHaveLength(0);

      await step(() => writes[0]!.finish.resolve());
      expect(posts).toHaveLength(2);
      expect(posts.map((post) => post.input.installationId)).toEqual([id, id]);
      expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
      expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
      expect(installationStorage.get(INSTALLATION_ID_KEY)).toBe(id);
      expect(await readInstallationId()).toBe(id);

      const logoutStartedAt = Date.now();
      let logoutFinished = false;
      let loggingOut: Promise<void> | undefined;
      await step(() => {
        loggingOut = observed!.logout().then(() => {
          logoutFinished = true;
        });
      });
      expect(removeListener).toHaveBeenCalledTimes(1);
      // Logout waits for the writes already sent before unregistering.
      expect(unregisterPushDevice).not.toHaveBeenCalled();
      expect(logoutFinished).toBe(false);

      // The second POST reaches the backend first.
      await step(() => posts[1]!.finish.resolve());
      expect(unregisterPushDevice).not.toHaveBeenCalled();
      await step(() => posts[0]!.finish.resolve());
      await loggingOut;
      expect(logoutFinished).toBe(true);

      expect(unregisterPushDevice).toHaveBeenCalledTimes(1);
      expect(unregisterPushDevice).toHaveBeenCalledWith(id);
      expect(activeRows.has(id)).toBe(false);
      expect([...activeRows.keys()]).toEqual(['other-installation']);
      expect(activeRows.get('other-installation')).toBe('other-expo-token');
      expect(logoutSession).toHaveBeenCalledWith('refresh-1');
      expect(store.get()).toBeNull();
      expect(sessionData.has(SESSION_STORAGE_KEY)).toBe(false);
      expect(screen.getByText('unauthenticated')).toBeTruthy();
      // The installation keeps its ID after logout.
      expect(installationStorage.get(INSTALLATION_ID_KEY)).toBe(id);
      // No clock advancement: the 3 s timeout played no part.
      expect(Date.now() - logoutStartedAt).toBe(0);
      expect(events.slice(-4)).toEqual([
        'POST-committed',
        'POST-committed',
        'DELETE',
        'session-logout',
      ]);
    } finally {
      if (view) await view.unmount();
      Platform.OS = previousOS;
      jest.useRealTimers();
    }
  });

  it('overlapping callers share one read and one write and get the same persisted ID', async () => {
    const { storage, data } = memoryStorage();
    const write = deferred<void>();
    jest.mocked(storage.setItem).mockImplementation(async (key, value) => {
      await write.promise;
      data.set(key, value);
    });
    setInstallationIdStorage(storage);

    const callers = [getOrCreateInstallationId(), getOrCreateInstallationId()];
    await flushMicrotasks();
    callers.push(getOrCreateInstallationId());
    await flushMicrotasks();
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    // Not cached until persisted.
    await expect(readInstallationId()).resolves.toBeNull();

    write.resolve();
    const ids = await Promise.all(callers);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.get(INSTALLATION_ID_KEY)).toBe(ids[0]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    await expect(readInstallationId()).resolves.toBe(ids[0]);
  });

  it('keeps the persisted ID when the in-memory cache is reset', async () => {
    const { storage } = memoryStorage();
    setInstallationIdStorage(storage);
    const first = await getOrCreateInstallationId();

    // A new launch: in-memory state gone, storage kept.
    setInstallationIdStorage(storage);
    await expect(readInstallationId()).resolves.toBe(first);
    setInstallationIdStorage(storage);
    await expect(getOrCreateInstallationId()).resolves.toBe(first);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('lets a later call retry after a failed initialization', async () => {
    const { storage, data } = memoryStorage();
    jest.mocked(storage.setItem).mockRejectedValueOnce(new Error('keychain unavailable'));
    setInstallationIdStorage(storage);

    const failed = [getOrCreateInstallationId(), getOrCreateInstallationId()];
    await expect(failed[0]).rejects.toThrow('keychain unavailable');
    await expect(failed[1]).rejects.toThrow('keychain unavailable');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    await expect(readInstallationId()).resolves.toBeNull();

    const id = await getOrCreateInstallationId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.get(INSTALLATION_ID_KEY)).toBe(id);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    await expect(getOrCreateInstallationId()).resolves.toBe(id);
  });

  it('starts over on the new storage when it is swapped during initialization', async () => {
    const old = memoryStorage();
    const read = deferred<string | null>();
    jest.mocked(old.storage.getItem).mockReturnValue(read.promise);
    setInstallationIdStorage(old.storage);
    const stale = getOrCreateInstallationId();
    await flushMicrotasks();

    const fresh = memoryStorage({ [INSTALLATION_ID_KEY]: 'install-fresh' });
    setInstallationIdStorage(fresh.storage);
    await expect(getOrCreateInstallationId()).resolves.toBe('install-fresh');

    read.resolve('install-old');
    await expect(stale).resolves.toBe('install-old');
    // The abandoned initialization does not replace the new storage's ID.
    await expect(getOrCreateInstallationId()).resolves.toBe('install-fresh');
    await expect(readInstallationId()).resolves.toBe('install-fresh');
  });
});
