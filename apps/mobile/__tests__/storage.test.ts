import * as SecureStore from 'expo-secure-store';

import {
  SESSION_STORAGE_KEY,
  deleteSession,
  getPlatformStorage,
  readSession,
  writeSession,
} from '@/auth/storage';

import { makeSession } from '../test-utils/session';

jest.mock('expo-secure-store', () => {
  const data = new Map<string, string>();
  return {
    __data: data,
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      data.delete(key);
    }),
  };
});

const secureData = (SecureStore as unknown as { __data: Map<string, string> }).__data;

describe('storage adapter (native / SecureStore)', () => {
  beforeEach(() => {
    secureData.clear();
    jest.clearAllMocks();
  });

  it('persists {accessToken, refreshToken, user} as JSON under one key', async () => {
    const storage = getPlatformStorage('ios');
    const session = makeSession();

    await writeSession(session, storage);

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_STORAGE_KEY, expect.any(String));
    expect(JSON.parse(secureData.get(SESSION_STORAGE_KEY) ?? '')).toEqual(session);
    await expect(readSession(storage)).resolves.toEqual(session);
  });

  it('deletes the session key', async () => {
    const storage = getPlatformStorage('android');
    await writeSession(makeSession(), storage);

    await deleteSession(storage);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    await expect(readSession(storage)).resolves.toBeNull();
  });

  it('discards a corrupt payload', async () => {
    secureData.set(SESSION_STORAGE_KEY, '{not json');

    await expect(readSession(getPlatformStorage('ios'))).resolves.toBeNull();
    expect(secureData.has(SESSION_STORAGE_KEY)).toBe(false);
  });
});

describe('storage adapter (web / localStorage)', () => {
  const g = globalThis as unknown as { window?: unknown };
  const originalWindow = g.window;

  function installLocalStorage() {
    const data = new Map<string, string>();
    const localStorage = {
      getItem: jest.fn((key: string) => data.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        data.set(key, value);
      }),
      removeItem: jest.fn((key: string) => {
        data.delete(key);
      }),
    };
    g.window = { localStorage };
    return { data, localStorage };
  }

  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    g.window = originalWindow;
  });

  it('uses localStorage and never touches SecureStore', async () => {
    const { data, localStorage } = installLocalStorage();
    const storage = getPlatformStorage('web');
    const session = makeSession();

    await writeSession(session, storage);

    expect(localStorage.setItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY, expect.any(String));
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(session);
    await expect(readSession(storage)).resolves.toEqual(session);

    await deleteSession(storage);
    expect(data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('degrades to "no session" without a window (static rendering)', async () => {
    g.window = undefined;
    const storage = getPlatformStorage('web');

    await expect(writeSession(makeSession(), storage)).resolves.toBeUndefined();
    await expect(readSession(storage)).resolves.toBeNull();
    await expect(deleteSession(storage)).resolves.toBeUndefined();
  });
});
