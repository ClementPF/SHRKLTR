import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import type { Challenge, InboxNotification, Tournament, User } from '@/api/types';
import ChallengeDetailRoute from '@/app/(app)/challenges/[id]';
import NotificationsRoute from '@/app/(app)/notifications';
import { createQueryClient } from '@/lib/query-client';

// Focus effects re-run when `refocus()` is called, like navigating Back to a mounted screen.
const mockFocusCallbacks = new Set<() => void>();
const mockParams: { id?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    Stack: { Screen: () => null },
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => {
      useEffect(() => {
        mockFocusCallbacks.add(effect);
        effect();
        return () => {
          mockFocusCallbacks.delete(effect);
        };
      }, [effect]);
    },
  };
});
jest.mock('@/api/endpoints');
jest.mock('@/auth/session', () => ({
  useSession: () => ({ user: { id: 'id-dev-alex', username: 'dev-alex' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);
const mockedRouter = jest.mocked(router);

const person = (username: string): User => ({
  id: `id-${username}`,
  username,
  accountType: 'REGISTERED',
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const tournament: Tournament = {
  id: 't-babyfoot',
  name: 'officebabyfoot',
  displayName: 'Office Babyfoot',
  isOver: false,
  sport: { id: 's1', name: 'babyfoot' },
  owner: null,
  group: null,
};

const ID = '5ea0c0de-0000-4000-8000-000000000101';
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const pending: Challenge = {
  id: ID,
  tournament,
  challenger: person('dev-alex'),
  opponent: person('dev-sam'),
  status: 'PENDING',
  deadlineAt: inDays(7),
  createdAt: inDays(-1),
  acceptedAt: null,
  resolvedAt: null,
  winner: null,
  gameId: null,
};
const accepted: Challenge = { ...pending, status: 'ACCEPTED', acceptedAt: inDays(0) };

const acceptance: InboxNotification = {
  id: 'n-accepted',
  type: 'challenge_accepted',
  category: 'challenges',
  title: 'dev-sam accepted your challenge',
  body: 'Your next game in Office Babyfoot decides it',
  target: { type: 'challenge', challengeId: ID },
  actor: person('dev-sam'),
  createdAt: inDays(0),
  readAt: null,
};

const WAITING_TEXT = 'Waiting for dev-sam to accept or decline.';

let client: QueryClient;
const wrap = (ui: ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;

async function refocus() {
  await act(async () => {
    for (const effect of [...mockFocusCallbacks]) effect();
  });
}

/** Opens the route the way the app does: the params of the href that was pushed. */
function lastPushedParams(): { id?: string } {
  const href = mockedRouter.push.mock.calls.at(-1)![0] as { params: { id: string } };
  return href.params;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.clear();
  // Production defaults (30 s staleTime), so a recently viewed challenge is still fresh. Only
  // garbage collection is turned off, so no 5-minute timers outlive the test.
  client = createQueryClient();
  const { queries } = client.getDefaultOptions();
  client.setDefaultOptions({
    queries: { ...queries, gcTime: Infinity },
    mutations: { gcTime: Infinity },
  });
  expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
  api.listNotifications.mockResolvedValue([acceptance]);
  api.getUnreadNotificationCount.mockResolvedValue({ count: 1 });
  api.markNotificationRead.mockResolvedValue({ ...acceptance, readAt: inDays(0) });
});

afterEach(() => client.clear());

describe('challenge detail revalidation', () => {
  it('shows ACCEPTED when the acceptance notification opens a challenge viewed as PENDING moments ago', async () => {
    let server = pending;
    api.getChallenge.mockImplementation(async () => server);

    // The challenger looks at the pending challenge, then goes to the inbox.
    mockParams.id = ID;
    const view = await render(wrap(<ChallengeDetailRoute />));
    expect(await screen.findByText(WAITING_TEXT)).toBeTruthy();
    expect(screen.getByTestId('challenge-status')).toHaveTextContent('PENDING');
    expect(api.getChallenge).toHaveBeenCalledTimes(1);

    // The opponent accepts within the stale time; the inbox shows the acceptance.
    server = accepted;
    await view.rerender(wrap(<NotificationsRoute />));
    await fireEvent.press(await screen.findByTestId('notification-n-accepted'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/challenges/[id]',
      params: { id: ID },
    });

    mockParams.id = lastPushedParams().id;
    await view.rerender(wrap(<ChallengeDetailRoute />));
    await waitFor(() =>
      expect(screen.getByTestId('challenge-status')).toHaveTextContent('ACCEPTED'),
    );
    expect(screen.getByTestId('challenge-state-text')).toHaveTextContent(
      /Accepted. Your next game against dev-sam/,
    );
    expect(screen.queryByText(WAITING_TEXT)).toBeNull();

    // One revalidation for the open, and no refetch loop afterwards.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(api.getChallenge).toHaveBeenCalledTimes(2);
  });

  it('revalidates a still-mounted detail screen when it is focused again', async () => {
    let server = pending;
    api.getChallenge.mockImplementation(async () => server);
    mockParams.id = ID;
    await render(wrap(<ChallengeDetailRoute />));
    expect(await screen.findByText(WAITING_TEXT)).toBeTruthy();

    server = accepted;
    await refocus();
    await waitFor(() =>
      expect(screen.getByTestId('challenge-status')).toHaveTextContent('ACCEPTED'),
    );
    expect(api.getChallenge).toHaveBeenCalledTimes(2);
  });
});
