import { jsonResponse, makeSession } from '../test-utils/session';

describe('dev session', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  // EXPO_PUBLIC_* values are read at module load, so each test loads a fresh module graph.
  function loadModule(): typeof import('@/auth/devSession') {
    let mod: typeof import('@/auth/devSession') | undefined;
    jest.isolateModules(() => {
      mod = jest.requireActual<typeof import('@/auth/devSession')>('@/auth/devSession');
    });
    return mod!;
  }

  it('POSTs /auth/dev-token with the EXPO_PUBLIC_DEV_AUTH value as x-dev-auth', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://api.test';
    process.env.EXPO_PUBLIC_DEV_AUTH = 'dev-secret';
    process.env.EXPO_PUBLIC_ENV = 'development';
    const { isDevSessionEnabled, requestDevSession } = loadModule();
    // Assigned after loading: importing expo installs its own global fetch.
    const fetchMock = jest.fn(async () => jsonResponse(200, makeSession()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(isDevSessionEnabled()).toBe(true);
    await expect(requestDevSession('dev-alex')).resolves.toEqual(makeSession());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('http://api.test/auth/dev-token');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'dev-alex' }));
    expect(headers['x-dev-auth']).toBe('dev-secret');
    expect(headers.Authorization).toBeUndefined();
  });

  it('is disabled in production builds', async () => {
    process.env.EXPO_PUBLIC_DEV_AUTH = 'dev-secret';
    process.env.EXPO_PUBLIC_ENV = 'production';
    const { isDevSessionEnabled, requestDevSession } = loadModule();
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(isDevSessionEnabled()).toBe(false);
    await expect(requestDevSession('dev-alex')).rejects.toThrow('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
