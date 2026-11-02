import type { QueryClient } from '@tanstack/react-query';

import { emitAuthLost } from '@/auth/auth-events';
import { sessionStore, type SessionStore } from '@/auth/session-store';
import { queryClient as defaultQueryClient } from '@/lib/query-client';

import { API_URL } from './config';
import { ApiError, NETWORK_ERROR, SESSION_CHANGED, SESSION_EXPIRED, toApiError } from './errors';
import type { TokenPair } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** Attach the Bearer token and recover from 401 via refresh. Defaults to true. */
  auth?: boolean;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  store: SessionStore;
  queryClient?: Pick<QueryClient, 'clear'>;
  fetchFn?: typeof fetch;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  put<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  /** Rotates the refresh token. Concurrent callers share one in-flight /auth/refresh. */
  refresh(): Promise<string | null>;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const base = baseUrl.replace(/\/+$/, '');
  const params = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number | boolean] => entry[1] != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `${base}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

async function parseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function createApiClient({
  baseUrl,
  store,
  queryClient,
  fetchFn,
}: ApiClientOptions): ApiClient {
  // Resolved per call so tests (and polyfills) that swap globalThis.fetch are honored.
  const doFetch = (input: string, init: RequestInit) => (fetchFn ?? globalThis.fetch)(input, init);
  // Keyed by session generation: a refresh started for a previous session must never be
  // shared with (or have its result applied to) the session that replaced it.
  let refreshInFlight: { generation: number; promise: Promise<string | null> } | null = null;
  // The generation transition made by the last refresh rejection, so requests of the expired
  // session report SESSION_EXPIRED rather than SESSION_CHANGED.
  let lastExpiry: { from: number; to: number } | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, init);
    } catch (err) {
      if (init.signal?.aborted) throw err;
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new ApiError(0, NETWORK_ERROR, message);
    }
  }

  async function loseSession(generation: number): Promise<void> {
    // clear() resolves false when this session was already replaced, or was replaced while
    // storage was being cleared; the cache and auth-lost then belong to the new session.
    const clearing = store.clear(generation);
    if (store.generation() !== generation)
      lastExpiry = { from: generation, to: store.generation() };
    if (!(await clearing)) return;
    queryClient?.clear();
    emitAuthLost();
  }

  async function performRefresh(generation: number): Promise<string | null> {
    const session = store.get();
    if (!session) return null;
    const response = await send(buildUrl(baseUrl, '/auth/refresh'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (response.ok) {
      const pair = await parseBody<TokenPair>(response);
      if (!(await store.updateTokens(pair, generation))) return null;
      return store.generation() === generation ? pair.accessToken : null;
    }
    // Only a definitive rejection ends the session; network errors and 5xx keep it so a
    // later request can retry the refresh.
    if (response.status >= 400 && response.status < 500) {
      await loseSession(generation);
      return null;
    }
    throw await toApiError(response);
  }

  function refresh(): Promise<string | null> {
    const generation = store.generation();
    if (refreshInFlight?.generation === generation) return refreshInFlight.promise;
    const entry = {
      generation,
      promise: performRefresh(generation).finally(() => {
        if (refreshInFlight === entry) refreshInFlight = null;
      }),
    };
    refreshInFlight = entry;
    return entry.promise;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, headers = {}, auth = true, signal } = options;
    const url = buildUrl(baseUrl, path, query);

    const run = (accessToken: string | undefined) => {
      const finalHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
      if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
      if (auth && accessToken) finalHeaders.Authorization = `Bearer ${accessToken}`;
      return send(url, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    };

    const complete = async (response: Response): Promise<T> => {
      if (!response.ok) throw await toApiError(response);
      return parseBody<T>(response);
    };

    if (!auth) return complete(await run(undefined));

    const generation = store.generation();
    const sessionChanged = () => store.generation() !== generation;
    const sessionChangedError = () =>
      new ApiError(401, SESSION_CHANGED, 'You were signed out while this request was running.');

    const protectedRequest = async (): Promise<T> => {
      const usedToken = store.get()?.accessToken;
      let response = await run(usedToken);
      if (sessionChanged()) throw sessionChangedError();

      if (response.status === 401 && usedToken) {
        // Another request may already have rotated the tokens while this one was in flight.
        const current = store.get()?.accessToken;
        const nextToken = current && current !== usedToken ? current : await refresh();
        if (!nextToken) {
          const expired =
            !sessionChanged() ||
            (lastExpiry?.from === generation && lastExpiry.to === store.generation());
          throw expired
            ? new ApiError(401, SESSION_EXPIRED, 'Your session has expired. Please sign in again.')
            : sessionChangedError();
        }
        if (sessionChanged()) throw sessionChangedError();
        response = await run(nextToken);
      }
      return complete(response);
    };

    // Every way out (data, error envelope, refresh failure, network error) is re-checked
    // after its last await: a result produced for a replaced session must never reach the
    // caller, which by now belongs to the new session.
    let result: T;
    try {
      result = await protectedRequest();
    } catch (err) {
      const expired = err instanceof ApiError && err.code === SESSION_EXPIRED;
      if (!expired && !signal?.aborted && sessionChanged()) throw sessionChangedError();
      throw err;
    }
    if (sessionChanged()) throw sessionChangedError();
    return result;
  }

  return {
    request,
    refresh,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  };
}

export const api = createApiClient({
  baseUrl: API_URL,
  store: sessionStore,
  queryClient: defaultQueryClient,
});
