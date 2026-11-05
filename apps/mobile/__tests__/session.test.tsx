import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { exchangeGoogleCode, logoutSession } from '@/api/endpoints';
import { SessionProvider, useSession } from '@/auth/session';
import { createSessionStore } from '@/auth/session-store';
import { requestDevSession } from '@/auth/devSession';
import { SESSION_STORAGE_KEY } from '@/auth/storage';

import { ApiError, SESSION_EXPIRED } from '@/api/errors';
import type { DevicePushToken, PushRegistrationOptions } from '@/notifications/push-types';

import { deferred, makeSession, memoryStorage, testUser } from '../test-utils/session';

jest.mock('@/api/endpoints', () => ({
  exchangeGoogleCode: jest.fn(),
  getMe: jest.fn(async () => {
    throw new Error('offline');
  }),
  logoutSession: jest.fn(async () => undefined),
}));
jest.mock('@/notifications/push-registration', () => ({
  registerForPushNotifications: jest.fn(async () => null),
  unregisterPushNotifications: jest.fn(async () => undefined),
  watchPushTokenChanges: jest.fn(() => () => undefined),
}));

function Probe() {
  const { status, user, logout } = useSession();
  return (
    <Text onPress={() => void logout()}>
      {status}:{user?.username ?? 'none'}
    </Text>
  );
}

jest.mock('@/auth/devSession', () => ({
  requestDevSession: jest.fn(),
}));

const GOOGLE_EXCHANGE = {
  code: 'auth-code',
  codeVerifier: 'verifier-xyz',
  redirectUri: 'http://localhost:8081',
};

function LoginProbe() {
  const { status, user, loginWithGoogleCode, loginWithDevUser } = useSession();
  return (
    <>
      <Text>
        {status}:{user?.username ?? 'none'}
      </Text>
      <Text onPress={() => void loginWithGoogleCode(GOOGLE_EXCHANGE)}>google</Text>
      <Text onPress={() => void loginWithDevUser('dev-sam')}>dev</Text>
    </>
  );
}

describe('SessionProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a loading state until stored tokens hydrate, then the session', async () => {
    const { storage } = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()) });
    const gate = deferred<void>();
    const realGet = storage.getItem;
    storage.getItem = async (key) => {
      await gate.promise;
      return realGet(key);
    };
    const registerPush = jest.fn(async () => null);

    await render(
      <SessionProvider store={createSessionStore(storage)} registerPush={registerPush}>
        <Probe />
      </SessionProvider>,
    );

    expect(screen.getByLabelText('Loading session')).toBeTruthy();
    expect(screen.queryByText(/authenticated/)).toBeNull();

    await act(async () => gate.resolve());

    expect(await screen.findByText('authenticated:dev-alex')).toBeTruthy();
    expect(registerPush).toHaveBeenCalledTimes(1);
  });

  it('is unauthenticated with no stored session and skips push registration', async () => {
    const registerPush = jest.fn(async () => null);

    await render(
      <SessionProvider
        store={createSessionStore(memoryStorage().storage)}
        registerPush={registerPush}
      >
        <Probe />
      </SessionProvider>,
    );

    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(registerPush).not.toHaveBeenCalled();
  });

  it('validates a restored session via /users/me and stores the fresh profile', async () => {
    const { storage, data } = memoryStorage({
      [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()),
    });
    const fetchCurrentUser = jest.fn(async () => ({ ...testUser, firstName: 'Alexandra' }));

    await render(
      <SessionProvider
        store={createSessionStore(storage)}
        registerPush={jest.fn(async () => null)}
        fetchCurrentUser={fetchCurrentUser}
      >
        <Probe />
      </SessionProvider>,
    );

    expect(await screen.findByText('authenticated:dev-alex')).toBeTruthy();
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY)!).user.firstName).toBe('Alexandra');
  });

  it('lands unauthenticated when the restored session cannot be refreshed', async () => {
    const { storage } = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()) });
    const store = createSessionStore(storage);
    // Mirrors the API client: a rejected refresh clears the store, then the request fails.
    const fetchCurrentUser = jest.fn(async () => {
      await store.clear();
      throw new ApiError(401, SESSION_EXPIRED, 'expired');
    });

    await render(
      <SessionProvider
        store={store}
        registerPush={jest.fn(async () => null)}
        fetchCurrentUser={fetchCurrentUser}
      >
        <Probe />
      </SessionProvider>,
    );

    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(screen.queryByText(/^authenticated/)).toBeNull();
  });

  it('keeps the stored session when validation fails for a non-auth reason', async () => {
    const { storage } = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()) });

    await render(
      <SessionProvider
        store={createSessionStore(storage)}
        registerPush={jest.fn(async () => null)}
        fetchCurrentUser={jest.fn(async () => {
          throw new ApiError(0, 'NETWORK_ERROR', 'offline');
        })}
      >
        <Probe />
      </SessionProvider>,
    );

    expect(await screen.findByText('authenticated:dev-alex')).toBeTruthy();
  });

  it('loginWithGoogleCode exchanges the code through the backend and stores the session', async () => {
    const { storage, data } = memoryStorage();
    const session = makeSession({ accessToken: 'google-access', refreshToken: 'google-refresh' });
    jest.mocked(exchangeGoogleCode).mockResolvedValueOnce(session);

    await render(
      <SessionProvider store={createSessionStore(storage)} registerPush={jest.fn(async () => null)}>
        <LoginProbe />
      </SessionProvider>,
    );
    const button = await screen.findByText('google');
    expect(screen.getByText('unauthenticated:none')).toBeTruthy();

    await act(async () => {
      button.props.onPress();
    });

    expect(await screen.findByText('authenticated:dev-alex')).toBeTruthy();
    expect(exchangeGoogleCode).toHaveBeenCalledWith(GOOGLE_EXCHANGE);
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY)!)).toEqual(session);
    expect(requestDevSession).not.toHaveBeenCalled();
  });

  it('loginWithDevUser still signs in through the dev session without touching Google', async () => {
    const { storage, data } = memoryStorage();
    const session = makeSession({ user: { ...testUser, username: 'dev-sam' } });
    jest.mocked(requestDevSession).mockResolvedValueOnce(session);

    await render(
      <SessionProvider store={createSessionStore(storage)} registerPush={jest.fn(async () => null)}>
        <LoginProbe />
      </SessionProvider>,
    );
    const button = await screen.findByText('dev');

    await act(async () => {
      button.props.onPress();
    });

    expect(await screen.findByText('authenticated:dev-sam')).toBeTruthy();
    expect(requestDevSession).toHaveBeenCalledWith('dev-sam');
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY)!)).toEqual(session);
  });

  it('logout revokes the refresh token, clears storage and the query cache', async () => {
    const { storage, data } = memoryStorage({
      [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()),
    });
    const queryClient = { clear: jest.fn() };

    await render(
      <SessionProvider
        store={createSessionStore(storage, { queryClient })}
        registerPush={jest.fn(async () => null)}
      >
        <Probe />
      </SessionProvider>,
    );
    const label = await screen.findByText('authenticated:dev-alex');

    await act(async () => {
      label.props.onPress();
    });

    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(logoutSession).toHaveBeenCalledWith('refresh-1');
    expect(data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });

  it('a login that completes while logout is still deleting storage keeps its session and cache', async () => {
    const { storage, data } = memoryStorage({
      [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()),
    });
    const queryClient = { clear: jest.fn() };
    const userB = { ...testUser, id: '00000000-0000-4000-8000-000000000002', username: 'dev-sam' };
    const sessionB = makeSession({
      accessToken: 'b-access',
      refreshToken: 'b-refresh',
      user: userB,
    });
    jest.mocked(requestDevSession).mockResolvedValue(sessionB);
    const deletion = deferred<void>();
    (storage.removeItem as jest.Mock).mockImplementationOnce(async (key: string) => {
      await deletion.promise;
      data.delete(key);
    });

    await render(
      <SessionProvider
        store={createSessionStore(storage, { queryClient })}
        registerPush={jest.fn(async () => null)}
      >
        <Probe />
        <LoginProbe />
      </SessionProvider>,
    );
    const [label] = await screen.findAllByText('authenticated:dev-alex');

    await act(async () => {
      label!.props.onPress();
    });
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      screen.getByText('dev').props.onPress();
    });
    await act(async () => {
      deletion.resolve();
    });

    expect(screen.getAllByText('authenticated:dev-sam').length).toBeGreaterThan(0);
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY)!)).toEqual(sessionB);
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it('logout never clears the cache after a login queued as its storage clear completes', async () => {
    const userB = { ...testUser, id: '00000000-0000-4000-8000-000000000002', username: 'dev-sam' };
    const sessionB = makeSession({
      accessToken: 'b-access',
      refreshToken: 'b-refresh',
      user: userB,
    });
    // Installs B at every microtask offset after storage deletion finishes, covering the
    // window between the clear transition's generation check and logout() resuming.
    for (let hops = 0; hops <= 12; hops += 1) {
      const { storage, data } = memoryStorage({
        [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()),
      });
      const events: string[] = [];
      const queryClient = { clear: jest.fn(() => events.push('cache-clear')) };
      const store = createSessionStore(storage, { queryClient });
      const deletion = deferred<void>();
      (storage.removeItem as jest.Mock).mockImplementationOnce(async (key: string) => {
        await deletion.promise;
        data.delete(key);
      });
      let logout: (() => Promise<void>) | null = null;
      function Capture() {
        logout = useSession().logout;
        return null;
      }

      const view = await render(
        <SessionProvider store={store} registerPush={jest.fn(async () => null)}>
          <Capture />
        </SessionProvider>,
      );
      expect(logout).not.toBeNull();

      await act(async () => {
        const signingOut = logout!();
        await new Promise((r) => setTimeout(r, 0));
        expect(storage.removeItem).toHaveBeenCalledTimes(1);
        deletion.resolve();
        let installB: Promise<void> = Promise.resolve();
        void (async () => {
          for (let i = 0; i < hops; i += 1) await Promise.resolve();
          events.push('install-B');
          installB = store.set(sessionB);
        })();
        await signingOut;
        await new Promise((r) => setTimeout(r, 0));
        await installB;
      });

      const installedAt = events.indexOf('install-B');
      expect(installedAt).toBeGreaterThanOrEqual(0);
      expect(events.slice(installedAt + 1)).toEqual([]);
      expect(store.get()).toEqual(sessionB);
      expect(JSON.parse(data.get(SESSION_STORAGE_KEY)!)).toEqual(sessionB);
      await view.unmount();
    }
  });
});

describe('SessionProvider push lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  const ROTATED: DevicePushToken = { type: 'ios', data: 'rotated-device-token' };

  async function renderSignedIn(props: {
    unregisterPush: () => Promise<void>;
    watchPushToken?: (onChange: (token: DevicePushToken) => void) => () => void;
    registerPush?: (options?: PushRegistrationOptions) => Promise<string | null>;
  }) {
    const { storage } = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()) });
    await render(
      <SessionProvider
        store={createSessionStore(storage)}
        registerPush={props.registerPush ?? jest.fn(async () => null)}
        unregisterPush={props.unregisterPush}
        watchPushToken={props.watchPushToken ?? (() => () => undefined)}
      >
        <Probe />
      </SessionProvider>,
    );
    return screen.findByText('authenticated:dev-alex');
  }

  it('unregisters this installation before revoking the session on logout', async () => {
    const order: string[] = [];
    const unregisterPush = jest.fn(async () => {
      order.push('unregister');
    });
    jest.mocked(logoutSession).mockImplementationOnce(async () => {
      order.push('logout');
    });
    const label = await renderSignedIn({ unregisterPush });

    await act(async () => {
      label.props.onPress();
    });

    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(unregisterPush).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['unregister', 'logout']);
  });

  it('still signs out when unregistering fails', async () => {
    const unregisterPush = jest.fn(async () => {
      throw new Error('offline');
    });
    const label = await renderSignedIn({ unregisterPush });

    await act(async () => {
      label.props.onPress();
    });

    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(logoutSession).toHaveBeenCalledWith('refresh-1');
  });

  it('still signs out when unregistering never answers', async () => {
    jest.useFakeTimers();
    try {
      const unregisterPush = jest.fn(() => new Promise<void>(() => undefined));
      const label = await renderSignedIn({ unregisterPush });

      await act(async () => {
        label.props.onPress();
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText('unauthenticated:none')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-registers with the rotated device token while signed in and stops watching on sign-out', async () => {
    const stop = jest.fn();
    let onRotate: ((token: DevicePushToken) => void) | null = null;
    const watchPushToken = jest.fn((onChange: (token: DevicePushToken) => void) => {
      onRotate = onChange;
      return stop;
    });
    const registerPush = jest.fn<Promise<string | null>, [PushRegistrationOptions?]>(
      async () => null,
    );
    const label = await renderSignedIn({
      unregisterPush: jest.fn(async () => undefined),
      watchPushToken,
      registerPush,
    });
    expect(registerPush).toHaveBeenCalledTimes(1);

    await act(async () => onRotate!(ROTATED));
    expect(registerPush).toHaveBeenCalledTimes(2);
    expect(registerPush.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ devicePushToken: ROTATED }),
    );

    await act(async () => {
      label.props.onPress();
    });
    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(stop).toHaveBeenCalled();
  });

  it('stops watching and ignores rotations as soon as logout starts', async () => {
    const stop = jest.fn();
    let onRotate: ((token: DevicePushToken) => void) | null = null;
    const watchPushToken = jest.fn((onChange: (token: DevicePushToken) => void) => {
      onRotate = onChange;
      return stop;
    });
    const registerPush = jest.fn<Promise<string | null>, [PushRegistrationOptions?]>(
      async () => null,
    );
    const unregistering = deferred<void>();
    const label = await renderSignedIn({
      unregisterPush: jest.fn(() => unregistering.promise),
      watchPushToken,
      registerPush,
    });
    expect(registerPush).toHaveBeenCalledTimes(1);

    await act(async () => {
      label.props.onPress();
    });
    // Logout is still waiting for the server, yet the watcher is already gone.
    expect(screen.getByText('authenticated:dev-alex')).toBeTruthy();
    expect(stop).toHaveBeenCalled();
    await act(async () => onRotate!(ROTATED));
    expect(registerPush).toHaveBeenCalledTimes(1);

    await act(async () => unregistering.resolve());
    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(registerPush).toHaveBeenCalledTimes(1);
  });

  it('registers again when the same user signs back in after logout', async () => {
    const { storage } = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(makeSession()) });
    jest
      .mocked(requestDevSession)
      .mockResolvedValueOnce(makeSession({ refreshToken: 'refresh-2' }));
    const registerPush = jest.fn<Promise<string | null>, [PushRegistrationOptions?]>(
      async () => null,
    );
    await render(
      <SessionProvider
        store={createSessionStore(storage)}
        registerPush={registerPush}
        unregisterPush={jest.fn(async () => undefined)}
        watchPushToken={() => () => undefined}
      >
        <Probe />
        <LoginProbe />
      </SessionProvider>,
    );
    const [label] = await screen.findAllByText('authenticated:dev-alex');
    expect(registerPush).toHaveBeenCalledTimes(1);

    await act(async () => {
      label!.props.onPress();
    });
    expect((await screen.findAllByText('unauthenticated:none')).length).toBeGreaterThan(0);
    await act(async () => {
      screen.getByText('dev').props.onPress();
    });

    expect((await screen.findAllByText('authenticated:dev-alex')).length).toBeGreaterThan(0);
    expect(registerPush).toHaveBeenCalledTimes(2);
    expect(registerPush.mock.calls[1]![0]!.signal!.aborted).toBe(false);
  });

  /**
   * A stand-in for registerForPushNotifications against a fake server: the token fetch and the
   * POST are separately controllable, and every server write is recorded in order.
   */
  function fakePushServer() {
    const events: string[] = [];
    const tokenFetch = deferred<void>();
    const write = deferred<void>();
    const registered = new Set<string>();
    const registerPush = jest.fn(async (options?: PushRegistrationOptions) => {
      await new Promise<void>((resolve) => {
        void tokenFetch.promise.then(resolve);
        options?.signal?.addEventListener('abort', () => resolve());
      });
      if (options?.signal?.aborted) return null;
      events.push('register-sent');
      await write.promise;
      registered.add('install-1');
      events.push('register-saved');
      return 'ExponentPushToken[abc]';
    });
    const unregisterPush = jest.fn(async () => {
      registered.delete('install-1');
      events.push('unregister');
    });
    jest.mocked(logoutSession).mockImplementationOnce(async () => {
      events.push('logout');
    });
    return { events, tokenFetch, write, registered, registerPush, unregisterPush };
  }

  it('cancels a registration still fetching its token, so it never writes after logout', async () => {
    const server = fakePushServer();
    const label = await renderSignedIn(server);
    expect(server.registerPush).toHaveBeenCalledTimes(1);

    await act(async () => {
      label.props.onPress();
    });
    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();

    await act(async () => {
      server.tokenFetch.resolve();
      server.write.resolve();
    });
    expect(server.events).toEqual(['unregister', 'logout']);
    expect(server.registered.size).toBe(0);
  });

  it('runs the final unregister only after an in-flight registration write lands', async () => {
    const server = fakePushServer();
    server.tokenFetch.resolve();
    const label = await renderSignedIn(server);
    await act(async () => undefined);
    expect(server.events).toEqual(['register-sent']);

    await act(async () => {
      label.props.onPress();
    });
    expect(server.unregisterPush).not.toHaveBeenCalled();

    await act(async () => server.write.resolve());
    expect(await screen.findByText('unauthenticated:none')).toBeTruthy();
    expect(server.events).toEqual(['register-sent', 'register-saved', 'unregister', 'logout']);
    expect(server.registered.size).toBe(0);
  });

  it('still signs out within the time limit when a registration write never finishes', async () => {
    jest.useFakeTimers();
    try {
      const server = fakePushServer();
      server.tokenFetch.resolve();
      const label = await renderSignedIn(server);
      await act(async () => undefined);
      expect(server.events).toEqual(['register-sent']);

      await act(async () => {
        label.props.onPress();
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText('unauthenticated:none')).toBeTruthy();
      expect(logoutSession).toHaveBeenCalledWith('refresh-1');
      // The unregister that was skipped for time must not fire later without a session.
      await act(async () => server.write.resolve());
      expect(server.unregisterPush).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
