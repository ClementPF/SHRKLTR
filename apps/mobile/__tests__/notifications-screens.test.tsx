import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { InboxNotification, NotificationPreferences, UserAchievement } from '@/api/types';
import SettingsScreen from '@/app/(app)/(tabs)/settings';
import { useSession } from '@/auth/session';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import {
  ACHIEVEMENTS_LOAD_FAILED_TEXT,
  AchievementsScreen,
} from '@/features/achievements/achievements-screen';
import {
  EMPTY_INBOX_TEXT,
  INBOX_LOAD_FAILED_TEXT,
  InboxScreen,
} from '@/features/notifications/inbox-screen';
import { NotificationBell } from '@/features/notifications/notification-bell';
import {
  NotificationSettingsScreen,
  PUSH_ONLY_TEXT,
  WEB_PUSH_TEXT,
} from '@/features/notifications/notification-settings-screen';
import { notificationKeys } from '@/features/notifications/queries';

import { deferred, makeSession } from '../test-utils/session';

jest.mock('@/api/endpoints');
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);

const GAME_A = '11111111-1111-4111-8111-111111111111';
const GAME_B = '22222222-2222-4222-8222-222222222222';

function notification(overrides: Partial<InboxNotification> & { id: string }): InboxNotification {
  return {
    type: 'game_recorded',
    category: 'games',
    title: 'You lost in Office Babyfoot',
    body: 'dev-sam beat you (-16 Elo)',
    target: { type: 'game', gameId: GAME_A },
    actor: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    readAt: null,
    ...overrides,
  };
}

const newest = notification({
  id: 'n-new',
  title: 'You won in Lunch Darts',
  body: 'You beat dev-jordan (+16 Elo)',
  target: { type: 'game', gameId: GAME_B },
  createdAt: '2026-11-05T12:00:00.000Z',
});
const middle = notification({
  id: 'n-mid',
  type: 'achievement_unlocked',
  category: 'achievements',
  title: 'Badge unlocked: First win',
  body: 'Win a game.',
  target: { type: 'achievements', username: 'dev-alex' },
  createdAt: '2026-11-05T11:00:00.000Z',
  readAt: '2026-11-05T11:30:00.000Z',
});
const oldest = notification({ id: 'n-old', createdAt: '2026-11-04T09:00:00.000Z' });

let client: QueryClient;
function renderWithClient(ui: ReactElement) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      {ui}
      <DropdownAlert />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Not resetAllMocks: that also wipes React Native's mocked Switch native component.
  jest.clearAllMocks();
  for (const fn of Object.values(api)) if (jest.isMockFunction(fn)) fn.mockReset();
  useAlertStore.setState({ current: null });
  jest.mocked(useSession).mockReturnValue({
    status: 'authenticated',
    session: makeSession(),
    user: makeSession().user,
    loginWithGoogleCode: jest.fn(),
    loginWithDevUser: jest.fn(),
    logout: jest.fn(async () => undefined),
    refresh: jest.fn(),
  });
});

afterEach(() => jest.restoreAllMocks());

describe('InboxScreen', () => {
  it('lists notifications in server (newest first) order with read and unread styling', async () => {
    api.listNotifications.mockResolvedValue([newest, middle, oldest]);
    api.getUnreadNotificationCount.mockResolvedValue({ count: 2 });
    await renderWithClient(<InboxScreen />);

    const rows = await screen.findAllByTestId(/^notification-n-[a-z]+$/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'notification-n-new',
      'notification-n-mid',
      'notification-n-old',
    ]);
    expect(api.listNotifications).toHaveBeenCalledWith({ page: 0, pageSize: 20 });
    // Readable event text, never the raw type code.
    expect(screen.getByText('You won in Lunch Darts')).toBeTruthy();
    expect(screen.queryByText(/game_recorded|achievement_unlocked/)).toBeNull();
    expect(screen.getByTestId('notification-n-new-unread')).toBeTruthy();
    expect(screen.queryByTestId('notification-n-mid-unread')).toBeNull();
    expect(screen.getByLabelText(/^Unread: You won in Lunch Darts/)).toBeTruthy();
    expect(screen.getByLabelText(/^Read: Badge unlocked: First win/)).toBeTruthy();
  });

  it('shows a usable empty state', async () => {
    api.listNotifications.mockResolvedValue([]);
    api.getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    await renderWithClient(<InboxScreen />);
    expect(await screen.findByText(EMPTY_INBOX_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('inbox-list')).toBeNull();
  });

  it('offers a retry when the inbox cannot load', async () => {
    api.listNotifications.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    api.getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    await renderWithClient(<InboxScreen />);
    expect(await screen.findByText(INBOX_LOAD_FAILED_TEXT)).toBeTruthy();
    api.listNotifications.mockResolvedValue([oldest]);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByTestId('notification-n-old')).toBeTruthy();
  });

  it('opening an unread game notification marks it read and opens the game', async () => {
    api.listNotifications.mockResolvedValue([newest, middle, oldest]);
    api.getUnreadNotificationCount.mockResolvedValue({ count: 2 });
    const marking = deferred<InboxNotification>();
    api.markNotificationRead.mockReturnValue(marking.promise);
    await renderWithClient(<InboxScreen />);

    await fireEvent.press(await screen.findByTestId('notification-n-new'));

    expect(api.markNotificationRead).toHaveBeenCalledWith('n-new');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/games/[id]', params: { id: GAME_B } });
    // Optimistic: the row and the bell count update before the server answers.
    await waitFor(() => expect(screen.queryByTestId('notification-n-new-unread')).toBeNull());
    expect(screen.getByTestId('notification-n-old-unread')).toBeTruthy();
    expect(client.getQueryData(notificationKeys.unreadCount())).toEqual({ count: 1 });

    marking.resolve({ ...newest, readAt: '2026-11-05T12:05:00.000Z' });
    // Settling refreshes the inbox and the bell count from the server.
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getUnreadNotificationCount).toHaveBeenCalledTimes(2));
  });

  it('reopening a read notification navigates without marking or decrementing again', async () => {
    api.listNotifications.mockResolvedValue([newest, middle, oldest]);
    api.getUnreadNotificationCount.mockResolvedValue({ count: 2 });
    await renderWithClient(<InboxScreen />);

    await fireEvent.press(await screen.findByTestId('notification-n-mid'));

    expect(api.markNotificationRead).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/achievements/[username]',
      params: { username: 'dev-alex' },
    });
    expect(client.getQueryData(notificationKeys.unreadCount())).toEqual({ count: 2 });
  });

  it('marks everything read and clears the unread count', async () => {
    api.listNotifications.mockResolvedValue([newest, middle, oldest]);
    api.getUnreadNotificationCount.mockResolvedValue({ count: 2 });
    api.markAllNotificationsRead.mockResolvedValue(undefined);
    await renderWithClient(<InboxScreen />);
    await screen.findByTestId('notification-n-new-unread');

    api.listNotifications.mockResolvedValue([
      { ...newest, readAt: '2026-11-05T12:10:00.000Z' },
      middle,
      { ...oldest, readAt: '2026-11-05T12:10:00.000Z' },
    ]);
    api.getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    await fireEvent.press(screen.getByLabelText('Mark all read'));

    expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryAllByTestId(/-unread$/)).toHaveLength(0));
    await waitFor(() =>
      expect(client.getQueryData(notificationKeys.unreadCount())).toEqual({ count: 0 }),
    );
    expect(screen.getByLabelText('Mark all read')).toBeDisabled();
  });

  it('disables Mark all read when nothing is unread', async () => {
    api.listNotifications.mockResolvedValue([middle]);
    api.getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    await renderWithClient(<InboxScreen />);
    await screen.findByTestId('notification-n-mid');
    await waitFor(() => expect(screen.getByLabelText('Mark all read')).toBeDisabled());
  });
});

describe('NotificationBell', () => {
  it('shows the unread count and opens the inbox', async () => {
    api.getUnreadNotificationCount.mockResolvedValue({ count: 3 });
    await renderWithClient(<NotificationBell />);
    expect(await screen.findByLabelText('Notifications, 3 unread')).toBeTruthy();
    expect(screen.getByTestId('notification-bell-count')).toHaveTextContent('3');
    await fireEvent.press(screen.getByTestId('notification-bell'));
    expect(router.push).toHaveBeenCalledWith('/notifications');
  });

  it('shows no count when nothing is unread, and caps large counts', async () => {
    api.getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    const view = await renderWithClient(<NotificationBell />);
    await waitFor(() => expect(api.getUnreadNotificationCount).toHaveBeenCalled());
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
    expect(screen.queryByTestId('notification-bell-count')).toBeNull();
    await view.unmount();

    api.getUnreadNotificationCount.mockResolvedValue({ count: 250 });
    await renderWithClient(<NotificationBell />);
    expect(await screen.findByTestId('notification-bell-count')).toHaveTextContent('99+');
  });
});

describe('NotificationSettingsScreen', () => {
  const allOn: NotificationPreferences = {
    games: true,
    challenges: true,
    achievements: true,
    claims: true,
    groups: true,
  };

  it('shows five push toggles and explains that the inbox always records', async () => {
    api.getNotificationPreferences.mockResolvedValue({ ...allOn, claims: false });
    await renderWithClient(<NotificationSettingsScreen />);

    expect(await screen.findByText(PUSH_ONLY_TEXT)).toBeTruthy();
    for (const key of ['games', 'challenges', 'achievements', 'claims', 'groups']) {
      expect(screen.getByTestId(`push-toggle-${key}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('Games push notifications').props.value).toBe(true);
    expect(screen.getByLabelText('Claims push notifications').props.value).toBe(false);
    expect(screen.queryByText(WEB_PUSH_TEXT)).toBeNull();
  });

  it('saves one category at a time and keeps the saved value', async () => {
    api.getNotificationPreferences.mockResolvedValue(allOn);
    api.updateNotificationPreferences.mockResolvedValue({ ...allOn, games: false });
    await renderWithClient(<NotificationSettingsScreen />);

    await fireEvent(await screen.findByTestId('push-toggle-games'), 'valueChange', false);

    expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ games: false });
    await waitFor(() => expect(screen.getByTestId('push-toggle-games').props.value).toBe(false));
    expect(screen.getByTestId('push-toggle-challenges').props.value).toBe(true);
  });

  it('rolls the switch back and reports when saving fails', async () => {
    api.getNotificationPreferences.mockResolvedValue(allOn);
    api.updateNotificationPreferences.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    await renderWithClient(<NotificationSettingsScreen />);

    await fireEvent(await screen.findByTestId('push-toggle-groups'), 'valueChange', false);

    expect(await screen.findByText(/Couldn't save your notification settings/)).toBeTruthy();
    expect(screen.getByTestId('push-toggle-groups').props.value).toBe(true);
  });

  it('tells web users that push only reaches the mobile app', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    api.getNotificationPreferences.mockResolvedValue(allOn);
    await renderWithClient(<NotificationSettingsScreen />);
    expect(await screen.findByText(WEB_PUSH_TEXT)).toBeTruthy();
  });

  it('is reachable from the Settings tab', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByLabelText('Notifications'));
    expect(router.push).toHaveBeenCalledWith('/settings/notifications');
  });
});

describe('AchievementsScreen', () => {
  const badges: UserAchievement[] = [
    {
      code: 'first_win',
      title: 'First win',
      description: 'Win a game.',
      unlocked: true,
      unlockedAt: '2026-11-05T12:00:00.000Z',
      source: { type: 'GAME', gameId: GAME_A },
    },
    {
      code: 'games_10',
      title: 'Regular',
      description: 'Play 10 games.',
      unlocked: false,
      unlockedAt: null,
      source: null,
    },
  ];

  it('lists locked and unlocked badges for the user', async () => {
    api.getUserAchievements.mockResolvedValue(badges);
    await renderWithClient(<AchievementsScreen username="dev-alex" />);
    expect(await screen.findByLabelText('First win, unlocked')).toBeTruthy();
    expect(screen.getByLabelText('Regular, locked')).toBeTruthy();
    expect(screen.getByText('Unlocked Nov 5, 2026')).toBeTruthy();
    expect(api.getUserAchievements).toHaveBeenCalledWith('dev-alex');
  });

  it('offers a retry when loading fails', async () => {
    api.getUserAchievements.mockRejectedValueOnce(new ApiError(404, 'USER_NOT_FOUND', 'nope'));
    await renderWithClient(<AchievementsScreen username="ghost" />);
    expect(await screen.findByText(ACHIEVEMENTS_LOAD_FAILED_TEXT)).toBeTruthy();
  });
});
