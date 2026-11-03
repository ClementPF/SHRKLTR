import { createSessionStore } from '@/auth/session-store';
import { SESSION_STORAGE_KEY } from '@/auth/storage';

import { deferred, makeSession, memoryStorage, testUser } from '../test-utils/session';

const userB = { ...testUser, id: '00000000-0000-4000-8000-000000000002', username: 'dev-sam' };
const sessionB = makeSession({ accessToken: 'b-access', refreshToken: 'b-refresh', user: userB });

function delayOnce(fn: jest.Mock, gate: Promise<void>) {
  const original = fn.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
  fn.mockImplementationOnce(async (...args: unknown[]) => {
    await gate;
    return original(...args);
  });
}

describe('session store generation isolation', () => {
  it('clear resolves true when nothing replaced it', async () => {
    const { storage, data } = memoryStorage();
    const store = createSessionStore(storage);
    await store.set(makeSession());

    await expect(store.clear()).resolves.toBe(true);
    expect(store.get()).toBeNull();
    expect(data.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it('clear resolves false when a new session replaced it during storage deletion', async () => {
    const { storage, data } = memoryStorage();
    const store = createSessionStore(storage);
    await store.set(makeSession());
    const deletion = deferred<void>();
    delayOnce(storage.removeItem as jest.Mock, deletion.promise);

    const clearing = store.clear();
    const installB = store.set(sessionB);
    deletion.resolve();

    await expect(clearing).resolves.toBe(false);
    await installB;
    expect(store.get()).toEqual(sessionB);
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
  });

  it('a stale token write that lands late does not overwrite the replacement session', async () => {
    const { storage, data } = memoryStorage();
    const store = createSessionStore(storage);
    await store.set(makeSession());
    const write = deferred<void>();
    delayOnce(storage.setItem as jest.Mock, write.promise);

    const rotating = store.updateTokens({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    const installB = store.set(sessionB);
    write.resolve();
    await Promise.all([rotating, installB]);

    expect(store.get()).toEqual(sessionB);
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
  });

  it('a hydrate that finishes reading after a login keeps the new session', async () => {
    const { storage, data } = memoryStorage({
      [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()),
    });
    const store = createSessionStore(storage);
    const read = deferred<void>();
    // Snapshot the stored value at call time, like a native read already in flight.
    (storage.getItem as jest.Mock).mockImplementationOnce(async (key: string) => {
      const value = data.get(key) ?? null;
      await read.promise;
      return value;
    });

    const hydrating = store.hydrate();
    const installB = store.set(sessionB);
    read.resolve();

    await expect(hydrating).resolves.toEqual(sessionB);
    await installB;
    expect(store.get()).toEqual(sessionB);
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
  });

  it('clear runs the cache clear inside its transition, without auth-lost', async () => {
    const { storage } = memoryStorage();
    const queryClient = { clear: jest.fn() };
    const onAuthLost = jest.fn();
    const store = createSessionStore(storage, { queryClient, onAuthLost });
    await store.set(makeSession());

    await store.clear(store.generation());

    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it('skips cleanup effects when a session is installed while storage is being cleared', async () => {
    const { storage } = memoryStorage();
    const queryClient = { clear: jest.fn() };
    const onAuthLost = jest.fn();
    const store = createSessionStore(storage, { queryClient, onAuthLost });
    await store.set(makeSession());
    const generationA = store.generation();
    const deletion = deferred<void>();
    delayOnce(storage.removeItem as jest.Mock, deletion.promise);

    const expiring = store.expire(generationA);
    const installB = store.set(sessionB);
    deletion.resolve();
    await Promise.all([expiring, installB]);

    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(onAuthLost).not.toHaveBeenCalled();
    expect(store.expiredFrom(generationA)).toBe(false);
    expect(store.get()).toEqual(sessionB);
  });

  it('expire records the expiry only for a completed clear of the current session', async () => {
    const { storage } = memoryStorage();
    const queryClient = { clear: jest.fn() };
    const onAuthLost = jest.fn();
    const store = createSessionStore(storage, { queryClient, onAuthLost });
    await store.set(makeSession());
    const generationA = store.generation();

    await store.expire(generationA);

    expect(store.get()).toBeNull();
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(store.expiredFrom(generationA)).toBe(true);

    // The recorded expiry stops being current once any other session state replaces it.
    await store.set(sessionB);
    expect(store.expiredFrom(generationA)).toBe(false);
  });

  it('a stale expire changes nothing and records no expiry', async () => {
    const { storage } = memoryStorage();
    const queryClient = { clear: jest.fn() };
    const onAuthLost = jest.fn();
    const store = createSessionStore(storage, { queryClient, onAuthLost });
    await store.set(makeSession());
    const generationA = store.generation();
    await store.set(sessionB);

    await store.expire(generationA);

    expect(store.get()).toEqual(sessionB);
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(onAuthLost).not.toHaveBeenCalled();
    expect(store.expiredFrom(generationA)).toBe(false);
  });

  it('updateUser with a stale generation changes nothing', async () => {
    const { storage, data } = memoryStorage();
    const store = createSessionStore(storage);
    await store.set(makeSession());
    const generationA = store.generation();
    await store.set(sessionB);

    await expect(store.updateUser({ ...testUser, firstName: 'Stale' }, generationA)).resolves.toBe(
      false,
    );

    expect(store.get()).toEqual(sessionB);
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
  });
});
