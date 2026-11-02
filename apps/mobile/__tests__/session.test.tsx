import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { logoutSession } from '@/api/endpoints';
import { SessionProvider, useSession } from '@/auth/session';
import { createSessionStore } from '@/auth/session-store';
import { SESSION_STORAGE_KEY } from '@/auth/storage';

import { deferred, makeSession, memoryStorage } from '../test-utils/session';

jest.mock('@/api/endpoints', () => ({
  exchangeGoogleIdToken: jest.fn(),
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
