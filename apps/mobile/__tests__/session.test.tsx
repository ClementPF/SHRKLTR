import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { logoutSession } from '@/api/endpoints';
import { SessionProvider, useSession } from '@/auth/session';
import { createSessionStore } from '@/auth/session-store';
import { SESSION_STORAGE_KEY } from '@/auth/storage';

import { ApiError, SESSION_EXPIRED } from '@/api/errors';

import { deferred, makeSession, memoryStorage, testUser } from '../test-utils/session';

jest.mock('@/api/endpoints', () => ({
  exchangeGoogleIdToken: jest.fn(),
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
});
