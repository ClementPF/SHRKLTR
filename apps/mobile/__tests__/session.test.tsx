import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { exchangeGoogleCode, logoutSession } from '@/api/endpoints';
import { SessionProvider, useSession } from '@/auth/session';
import { createSessionStore } from '@/auth/session-store';
import { requestDevSession } from '@/auth/devSession';
import { SESSION_STORAGE_KEY } from '@/auth/storage';

import { ApiError, SESSION_EXPIRED } from '@/api/errors';

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
      <SessionProvider
        store={createSessionStore(storage)}
        queryClient={{ clear: jest.fn() }}
        registerPush={registerPush}
      >
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
        queryClient={{ clear: jest.fn() }}
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
        queryClient={{ clear: jest.fn() }}
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
        queryClient={{ clear: jest.fn() }}
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
        queryClient={{ clear: jest.fn() }}
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
      <SessionProvider
        store={createSessionStore(storage)}
        queryClient={{ clear: jest.fn() }}
        registerPush={jest.fn(async () => null)}
      >
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
      <SessionProvider
        store={createSessionStore(storage)}
        queryClient={{ clear: jest.fn() }}
        registerPush={jest.fn(async () => null)}
      >
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
        store={createSessionStore(storage)}
        queryClient={queryClient}
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
        store={createSessionStore(storage)}
        queryClient={queryClient}
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
});
