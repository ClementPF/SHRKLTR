import type { User } from '@/api/types';
import type { KeyValueStorage, StoredSession } from '@/auth/storage';

export const testUser: User = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'dev-alex',
  accountType: 'REGISTERED',
  firstName: 'Alex',
  lastName: 'Martin',
  pictureUrl: null,
  locale: null,
};

export function makeSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', user: testUser, ...overrides };
}

export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: jest.fn(async (key: string) => data.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return { storage, data };
}

export function jsonResponse(status: number, body?: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as Response;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
