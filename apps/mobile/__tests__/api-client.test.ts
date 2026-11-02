import { onAuthLost } from '@/auth/auth-events';
import { createApiClient } from '@/api/client';
import { ApiError, SESSION_CHANGED, SESSION_EXPIRED } from '@/api/errors';
import { createSessionStore } from '@/auth/session-store';
import { SESSION_STORAGE_KEY } from '@/auth/storage';

import {
  deferred,
  jsonResponse,
  makeSession,
  memoryStorage,
  testUser,
} from '../test-utils/session';

const BASE = 'http://api.test';

async function setup(session = makeSession()) {
  const { storage, data } = memoryStorage();
  const queryClient = { clear: jest.fn() };
  const store = createSessionStore(storage, { queryClient });
  await store.set(session);
  const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>();
  const client = createApiClient({
    baseUrl: BASE,
    store,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  const authHeader = (call: number) =>
    (fetchFn.mock.calls[call]?.[1].headers as Record<string, string>).Authorization;
  const refreshCalls = () => fetchFn.mock.calls.filter(([url]) => url === `${BASE}/auth/refresh`);
  return { client, store, storage, data, queryClient, fetchFn, authHeader, refreshCalls };
}

function deferredBodyResponse(status: number, body: Promise<string>): Response {
  return { ok: status >= 200 && status < 300, status, text: () => body } as Response;
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

  it('clears the session and query cache and emits auth-lost on a definitive 4xx refresh rejection', async () => {
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
    for (const result of results) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        status: 401,
        code: SESSION_EXPIRED,
      });
    }
    expect(refreshCalls()).toHaveLength(1);
    expect(store.get()).toBeNull();
    expect(data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps the session when refresh hits a network error (transient: retried by a later request)', async () => {
    const { client, store, queryClient, fetchFn, refreshCalls, authHeader } = await setup();
    const lost = jest.fn();
    const unsubscribe = onAuthLost(lost);
    let refreshFails = true;
    fetchFn.mockImplementation(async (url, init) => {
      if (url === `${BASE}/auth/refresh`) {
        if (refreshFails) throw new TypeError('Network request failed');
        return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access-2' ? jsonResponse(200, { ok: true }) : jsonResponse(401);
    });

    await expect(client.get('/users/me')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    expect(store.get()).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();

    refreshFails = false;
    await expect(client.get('/users/me')).resolves.toEqual({ ok: true });
    expect(refreshCalls()).toHaveLength(2);
    expect(refreshCalls()[1]![1].body).toBe(JSON.stringify({ refreshToken: 'refresh-1' }));
    expect(authHeader(fetchFn.mock.calls.length - 1)).toBe('Bearer access-2');
    unsubscribe();
  });

  it('keeps the session when refresh answers 5xx (transient) and surfaces the server error', async () => {
    const { client, store, data, queryClient, fetchFn, refreshCalls } = await setup();
    const lost = jest.fn();
    const unsubscribe = onAuthLost(lost);
    fetchFn.mockImplementation(async (url) =>
      url === `${BASE}/auth/refresh`
        ? jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'down' } })
        : jsonResponse(401),
    );

    await expect(client.get('/users/me')).rejects.toMatchObject({
      status: 503,
      code: 'UNAVAILABLE',
    });
    expect(refreshCalls()).toHaveLength(1);
    expect(store.get()).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(data.has(SESSION_STORAGE_KEY)).toBe(true);
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('reuses tokens rotated by another request while this one was in flight', async () => {
    const { client, fetchFn, refreshCalls, authHeader } = await setup();
    const slow = deferred<Response>();
    fetchFn.mockImplementation(async (url, init) => {
      if (url === `${BASE}/auth/refresh`) {
        return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url === `${BASE}/slow` && auth === 'Bearer access-1') return slow.promise;
      return auth === 'Bearer access-2' ? jsonResponse(200, { url }) : jsonResponse(401);
    });

    const slowRequest = client.get('/slow');
    await expect(client.get('/users/me')).resolves.toEqual({ url: `${BASE}/users/me` });
    slow.resolve(jsonResponse(401));

    await expect(slowRequest).resolves.toEqual({ url: `${BASE}/slow` });
    expect(refreshCalls()).toHaveLength(1);
    expect(authHeader(fetchFn.mock.calls.length - 1)).toBe('Bearer access-2');
  });

  describe('session generation isolation', () => {
    const userB = { ...testUser, id: '00000000-0000-4000-8000-000000000002', username: 'dev-sam' };
    const sessionB = makeSession({
      accessToken: 'b-access',
      refreshToken: 'b-refresh',
      user: userB,
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('discards a refresh that succeeds after an account switch (no token merge)', async () => {
      const { client, store, data, fetchFn, refreshCalls } = await setup();
      const refreshResponse = deferred<Response>();
      fetchFn.mockImplementation(async (url) =>
        url === `${BASE}/auth/refresh` ? refreshResponse.promise : jsonResponse(401),
      );

      const request = client.get('/users/me');
      await flush();
      expect(refreshCalls()).toHaveLength(1);

      await store.set(sessionB);
      refreshResponse.resolve(
        jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
      );

      await expect(request).rejects.toBeInstanceOf(ApiError);
      expect(store.get()).toEqual(sessionB);
      expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
      // No replay of the old request with any credentials.
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('keeps the replacement session when the old refresh is rejected after a switch', async () => {
      const { client, store, data, queryClient, fetchFn } = await setup();
      const lost = jest.fn();
      const unsubscribe = onAuthLost(lost);
      const refreshResponse = deferred<Response>();
      fetchFn.mockImplementation(async (url) =>
        url === `${BASE}/auth/refresh` ? refreshResponse.promise : jsonResponse(401),
      );

      const request = client.get('/users/me');
      await flush();
      await store.set(sessionB);
      refreshResponse.resolve(
        jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'revoked' } }),
      );

      await expect(request).rejects.toMatchObject({ status: 401, code: SESSION_CHANGED });
      expect(store.get()).toEqual(sessionB);
      expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
      expect(queryClient.clear).not.toHaveBeenCalled();
      expect(lost).not.toHaveBeenCalled();
      expect(store.expiredFrom(store.generation())).toBe(false);
      unsubscribe();
    });

    it('a stale 4xx refresh rejection after a switch reports SESSION_CHANGED, never SESSION_EXPIRED', async () => {
      const { client, store, fetchFn } = await setup();
      const generationA = store.generation();
      const refreshResponse = deferred<Response>();
      fetchFn.mockImplementation(async (url) =>
        url === `${BASE}/auth/refresh` ? refreshResponse.promise : jsonResponse(401),
      );

      const requests = [client.get('/users/me'), client.get('/sports')];
      await flush();
      await store.set(sessionB);
      refreshResponse.resolve(jsonResponse(400, { error: { code: 'BAD', message: 'invalid' } }));

      const results = await Promise.allSettled(requests);
      for (const result of results) {
        expect(result.status).toBe('rejected');
        const reason = (result as PromiseRejectedResult).reason as ApiError;
        expect(reason).toBeInstanceOf(ApiError);
        expect(reason.status).toBe(401);
        expect(reason.code).toBe(SESSION_CHANGED);
      }
      expect(store.expiredFrom(generationA)).toBe(false);
      expect(store.get()).toEqual(sessionB);
    });

    it('does not refresh or replay a late 401 from the previous session', async () => {
      const { client, store, fetchFn, refreshCalls } = await setup();
      const late = deferred<Response>();
      fetchFn.mockImplementation(async () => late.promise);

      const request = client.get('/users/me');
      await flush();
      await store.set(sessionB);
      late.resolve(jsonResponse(401));

      await expect(request).rejects.toMatchObject({ status: 401 });
      expect(refreshCalls()).toHaveLength(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(store.get()).toEqual(sessionB);
    });

    it('does not refresh or clear anything for a late 401 after logout', async () => {
      const { client, store, queryClient, fetchFn, refreshCalls } = await setup();
      const lost = jest.fn();
      const unsubscribe = onAuthLost(lost);
      const late = deferred<Response>();
      fetchFn.mockImplementation(async () => late.promise);

      const request = client.get('/users/me');
      await flush();
      await store.clear();
      expect(queryClient.clear).toHaveBeenCalledTimes(1);
      late.resolve(jsonResponse(401));

      await expect(request).rejects.toMatchObject({ status: 401 });
      expect(refreshCalls()).toHaveLength(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(queryClient.clear).toHaveBeenCalledTimes(1);
      expect(lost).not.toHaveBeenCalled();
      unsubscribe();
    });

    it('starts a fresh refresh for the new session instead of joining the stale one', async () => {
      const { client, store, fetchFn, refreshCalls, authHeader } = await setup();
      const staleRefresh = deferred<Response>();
      fetchFn.mockImplementation(async (url, init) => {
        if (url === `${BASE}/auth/refresh`) {
          const { refreshToken } = JSON.parse(String(init.body)) as { refreshToken: string };
          return refreshToken === 'refresh-1'
            ? staleRefresh.promise
            : jsonResponse(200, { accessToken: 'b-access-2', refreshToken: 'b-refresh-2' });
        }
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === 'Bearer b-access-2' ? jsonResponse(200, { url }) : jsonResponse(401);
      });

      const stale = client.get('/users/me');
      await flush();
      await store.set(sessionB);

      await expect(client.get('/tournaments')).resolves.toEqual({ url: `${BASE}/tournaments` });
      expect(refreshCalls()).toHaveLength(2);
      expect(refreshCalls()[1]![1].body).toBe(JSON.stringify({ refreshToken: 'b-refresh' }));
      expect(authHeader(fetchFn.mock.calls.length - 1)).toBe('Bearer b-access-2');

      staleRefresh.resolve(
        jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
      );
      await expect(stale).rejects.toBeInstanceOf(ApiError);
      expect(store.get()).toMatchObject({
        accessToken: 'b-access-2',
        refreshToken: 'b-refresh-2',
        user: userB,
      });
    });

    it('client.refresh() resolves null when the session changed mid-refresh', async () => {
      const { client, store, fetchFn } = await setup();
      const refreshResponse = deferred<Response>();
      fetchFn.mockImplementation(async () => refreshResponse.promise);

      const pending = client.refresh();
      await flush();
      await store.set(sessionB);
      refreshResponse.resolve(
        jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
      );

      await expect(pending).resolves.toBeNull();
      expect(store.get()).toEqual(sessionB);
    });

    it('never delivers a successful retry that resolves after an account switch', async () => {
      const { client, store, fetchFn } = await setup();
      const retry = deferred<Response>();
      fetchFn.mockImplementation(async (url, init) => {
        if (url === `${BASE}/auth/refresh`) {
          return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
        }
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === 'Bearer access-2' ? retry.promise : jsonResponse(401);
      });

      const request = client.get('/users/me');
      await flush();
      expect(fetchFn).toHaveBeenCalledTimes(3);
      await store.set(sessionB);
      retry.resolve(jsonResponse(200, { secret: 'A' }));

      await expect(request).rejects.toMatchObject({ status: 401, code: SESSION_CHANGED });
      expect(store.get()).toEqual(sessionB);
    });

    it('never delivers a retry body that finishes parsing after logout', async () => {
      const { client, store, fetchFn } = await setup();
      const body = deferred<string>();
      fetchFn.mockImplementation(async (url, init) => {
        if (url === `${BASE}/auth/refresh`) {
          return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
        }
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === 'Bearer access-2'
          ? deferredBodyResponse(200, body.promise)
          : jsonResponse(401);
      });

      const request = client.get('/users/me');
      await flush();
      await store.clear();
      body.resolve(JSON.stringify({ secret: 'A' }));

      await expect(request).rejects.toMatchObject({ status: 401, code: SESSION_CHANGED });
    });

    it('never delivers an initial 200 that arrives after an account switch', async () => {
      const { client, store, fetchFn } = await setup();
      const late = deferred<Response>();
      fetchFn.mockImplementation(async () => late.promise);

      const request = client.get('/users/me');
      await flush();
      await store.set(sessionB);
      late.resolve(jsonResponse(200, { secret: 'A' }));

      await expect(request).rejects.toMatchObject({ status: 401, code: SESSION_CHANGED });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('never delivers an initial 200 body that finishes parsing after an account switch', async () => {
      const { client, store, fetchFn } = await setup();
      const body = deferred<string>();
      fetchFn.mockResolvedValueOnce(deferredBodyResponse(200, body.promise));

      const request = client.get('/users/me');
      await flush();
      await store.set(sessionB);
      body.resolve(JSON.stringify({ secret: 'A' }));

      await expect(request).rejects.toMatchObject({ status: 401, code: SESSION_CHANGED });
      expect(store.get()).toEqual(sessionB);
    });

    it('rejects a stale retry promptly without reading a body that never settles', async () => {
      const { client, store, fetchFn } = await setup();
      const retry = deferred<Response>();
      const text = jest.fn(() => new Promise<string>(() => undefined));
      fetchFn.mockImplementation(async (url, init) => {
        if (url === `${BASE}/auth/refresh`) {
          return jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
        }
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === 'Bearer access-2' ? retry.promise : jsonResponse(401);
      });

      const request = client.get('/users/me');
      await flush();
      expect(fetchFn).toHaveBeenCalledTimes(3);
      await store.set(sessionB);
      retry.resolve({ ok: true, status: 200, text } as unknown as Response);

      const timedOut = Symbol('timed out');
      const outcome = await Promise.race([
        request.catch((e: unknown) => e),
        new Promise((r) => setTimeout(() => r(timedOut), 50)),
      ]);
      expect(outcome).not.toBe(timedOut);
      expect(outcome).toMatchObject({ status: 401, code: SESSION_CHANGED });
      expect(text).not.toHaveBeenCalled();
    });

    it("does not surface the old session's error response after a switch", async () => {
      const { client, store, fetchFn } = await setup();
      const late = deferred<Response>();
      fetchFn.mockImplementation(async () => late.promise);

      const request = client.get('/users/me');
      await flush();
      await store.set(sessionB);
      late.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'A only' } }));

      await expect(request).rejects.toMatchObject({ status: 401, code: SESSION_CHANGED });
    });

    it('leaves auth:false requests unguarded across a switch', async () => {
      const { client, store, fetchFn } = await setup();
      const late = deferred<Response>();
      fetchFn.mockImplementation(async () => late.promise);

      const request = client.get('/health', { auth: false });
      await flush();
      await store.set(sessionB);
      late.resolve(jsonResponse(200, { ok: true }));

      await expect(request).resolves.toEqual({ ok: true });
    });

    it('keeps a session installed while the lost session is still being deleted from storage', async () => {
      const { client, store, storage, data, queryClient, fetchFn } = await setup();
      const lost = jest.fn();
      const unsubscribe = onAuthLost(lost);
      const deletion = deferred<void>();
      (storage.removeItem as jest.Mock).mockImplementationOnce(async (key: string) => {
        await deletion.promise;
        data.delete(key);
      });
      fetchFn.mockImplementation(async (url) =>
        url === `${BASE}/auth/refresh`
          ? jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'revoked' } })
          : jsonResponse(401),
      );

      const request = client.get('/users/me');
      await flush();
      expect(store.get()).toBeNull();
      expect(storage.removeItem).toHaveBeenCalledTimes(1);

      const installB = store.set(sessionB);
      expect(store.get()).toEqual(sessionB);
      deletion.resolve();
      await installB;

      await expect(request).rejects.toMatchObject({ status: 401, code: SESSION_CHANGED });
      expect(store.get()).toEqual(sessionB);
      expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
      expect(queryClient.clear).not.toHaveBeenCalled();
      expect(lost).not.toHaveBeenCalled();
      unsubscribe();
    });

    it('never clears the cache or emits auth-lost after a replacement queued as the expiry clear completes', async () => {
      // Installs B at every microtask offset after storage deletion finishes, covering the
      // window between the clear transition's generation check and any later continuation.
      for (let hops = 0; hops <= 12; hops += 1) {
        const { client, store, storage, data, queryClient, fetchFn } = await setup();
        const events: string[] = [];
        queryClient.clear.mockImplementation(() => events.push('cache-clear'));
        const unsubscribe = onAuthLost(() => events.push('auth-lost'));
        const deletion = deferred<void>();
        (storage.removeItem as jest.Mock).mockImplementationOnce(async (key: string) => {
          await deletion.promise;
          data.delete(key);
        });
        fetchFn.mockImplementation(async (url) =>
          url === `${BASE}/auth/refresh`
            ? jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'revoked' } })
            : jsonResponse(401),
        );

        const request = client.get('/users/me').catch((e: unknown) => e);
        await flush();
        expect(storage.removeItem).toHaveBeenCalledTimes(1);

        deletion.resolve();
        let installB: Promise<void> = Promise.resolve();
        void (async () => {
          for (let i = 0; i < hops; i += 1) await Promise.resolve();
          events.push('install-B');
          installB = store.set(sessionB);
        })();

        const error = await request;
        await flush();
        await installB;

        expect(error).toBeInstanceOf(ApiError);
        expect(events).toContain('install-B');
        const installedAt = events.indexOf('install-B');
        expect(events.slice(installedAt + 1)).toEqual([]);
        expect(events.filter((e) => e === 'cache-clear').length).toBeLessThanOrEqual(1);
        expect(store.get()).toEqual(sessionB);
        expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? '')).toEqual(sessionB);
        unsubscribe();
      }
    });
  });
});
