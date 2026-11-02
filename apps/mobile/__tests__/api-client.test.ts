import { onAuthLost } from '@/auth/auth-events';
import { createApiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { createSessionStore } from '@/auth/session-store';
import { SESSION_STORAGE_KEY } from '@/auth/storage';

import { deferred, jsonResponse, makeSession, memoryStorage } from '../test-utils/session';

const BASE = 'http://api.test';

async function setup(session = makeSession()) {
  const { storage, data } = memoryStorage();
  const store = createSessionStore(storage);
  await store.set(session);
  const queryClient = { clear: jest.fn() };
  const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>();
  const client = createApiClient({
    baseUrl: BASE,
    store,
    queryClient,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  const authHeader = (call: number) =>
    (fetchFn.mock.calls[call]?.[1].headers as Record<string, string>).Authorization;
  const refreshCalls = () => fetchFn.mock.calls.filter(([url]) => url === `${BASE}/auth/refresh`);
  return { client, store, data, queryClient, fetchFn, authHeader, refreshCalls };
}

describe('api client', () => {
  it('attaches the Bearer access token', async () => {
    const { client, fetchFn, authHeader } = await setup();
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { id: 'me' }));

    await expect(client.get('/users/me')).resolves.toEqual({ id: 'me' });

    expect(fetchFn).toHaveBeenCalledWith(`${BASE}/users/me`, expect.anything());
    expect(authHeader(0)).toBe('Bearer access-1');
  });

  it('omits the Bearer token for auth:false calls and serializes query + body', async () => {
    const { client, fetchFn, authHeader } = await setup();
    fetchFn.mockResolvedValueOnce(jsonResponse(200, []));

    await client.post(
      '/auth/token',
      { idToken: 'x' },
      { auth: false, query: { a: 'b c', skip: undefined } },
    );

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/auth/token?a=b%20c`);
    expect(init.body).toBe(JSON.stringify({ idToken: 'x' }));
    expect(authHeader(0)).toBeUndefined();
  });

  it('parses the error envelope into a typed ApiError', async () => {
    const { client, fetchFn } = await setup();
    fetchFn.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'USER_NOT_FOUND', message: 'User not found' } }),
    );

    const error = await client.get('/users/nobody').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'USER_NOT_FOUND', message: 'User not found' });
  });

  it('refreshes on 401 and retries the request once with the new token', async () => {
    const { client, store, data, fetchFn, authHeader, refreshCalls } = await setup();
    fetchFn
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(client.get('/users/me')).resolves.toEqual({ ok: true });

    expect(refreshCalls()).toHaveLength(1);
    expect(refreshCalls()[0]![1].body).toBe(JSON.stringify({ refreshToken: 'refresh-1' }));
    expect(authHeader(2)).toBe('Bearer access-2');
    expect(store.get()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
  });

  it('retries only once: a second 401 surfaces without another refresh', async () => {
    const { client, store, fetchFn, refreshCalls } = await setup();
    fetchFn
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'no' } }));

    await expect(client.get('/users/me')).rejects.toMatchObject({ status: 401 });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(refreshCalls()).toHaveLength(1);
    expect(store.get()).not.toBeNull();
  });

  it('shares one /auth/refresh call between concurrent 401s (single-flight)', async () => {
    const { client, fetchFn, refreshCalls } = await setup();
    const refreshResponse = deferred<Response>();
    fetchFn.mockImplementation(async (url, init) => {
      if (url === `${BASE}/auth/refresh`) return refreshResponse.promise;
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access-2' ? jsonResponse(200, { url }) : jsonResponse(401);
    });

    const a = client.get('/users/me');
    const b = client.get('/tournaments');
    // Let both requests receive their 401 and join the pending refresh.
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshCalls()).toHaveLength(1);

    refreshResponse.resolve(
      jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
    );

    await expect(Promise.all([a, b])).resolves.toEqual([
      { url: `${BASE}/users/me` },
      { url: `${BASE}/tournaments` },
    ]);
    expect(refreshCalls()).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('clears the session and query cache and emits auth-lost when refresh fails', async () => {
    const { client, store, data, queryClient, fetchFn, refreshCalls } = await setup();
    const lost = jest.fn();
    const unsubscribe = onAuthLost(lost);
    fetchFn.mockImplementation(async (url) =>
      url === `${BASE}/auth/refresh`
        ? jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'revoked' } })
        : jsonResponse(401),
    );

    const results = await Promise.allSettled([client.get('/users/me'), client.get('/sports')]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect((results[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
    });
    expect(refreshCalls()).toHaveLength(1);
    expect(store.get()).toBeNull();
    expect(data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps the session when refresh hits a network error', async () => {
    const { client, store, fetchFn } = await setup();
    fetchFn.mockImplementation(async (url) => {
      if (url === `${BASE}/auth/refresh`) throw new TypeError('Network request failed');
      return jsonResponse(401);
    });

    await expect(client.get('/users/me')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    expect(store.get()).not.toBeNull();
  });
});
