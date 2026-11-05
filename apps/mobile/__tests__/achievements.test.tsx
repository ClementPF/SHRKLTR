import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type {
  AchievementUnlock,
  Game,
  Stats,
  Tournament,
  User,
  UserAchievement,
} from '@/api/types';
import { useSession } from '@/auth/session';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import { AchievementsScreen } from '@/features/achievements/achievements-screen';
import { BadgeStrip } from '@/features/achievements/badge-strip';
import { EMPTY_FEED_TEXT, FeedScreen } from '@/features/feed/feed-screen';
import { ProfileScreen } from '@/features/feed/profile-screen';

import { makeSession } from '../test-utils/session';

jest.mock('@/api/endpoints');
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);

const GAME_ID = '11111111-1111-4111-8111-111111111111';

const user = (username: string): User => ({
  id: `id-${username}`,
  username,
  accountType: 'REGISTERED',
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const tournament: Tournament = {
  id: 't1',
  name: 'officebabyfoot',
  displayName: 'Office Babyfoot',
  isOver: false,
  sport: { id: 's1', name: 'babyfoot' },
  owner: null,
};

const stats: Stats = {
  id: 'st1',
  user: user('dev-alex'),
  tournament,
  score: 1016,
  bestScore: 1016,
  worstScore: 1000,
  gameCount: 1,
  winCount: 1,
  loseCount: 0,
  tieCount: 0,
  winStreak: 1,
  loseStreak: 0,
  tieStreak: 0,
  longestWinStreak: 1,
  longestLoseStreak: 0,
  longestTieStreak: 0,
  bestRivalry: null,
  worstRivalry: null,
};

const game: Game = {
  id: GAME_ID,
  date: '2026-11-05T12:00:00.000Z',
  tournament,
  outcomes: [
    { id: 'o1', result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: user('dev-alex') },
    { id: 'o2', result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: user('dev-sam') },
  ],
};

const firstWin: UserAchievement = {
  code: 'first_win',
  title: 'First win',
  description: 'Win a game.',
  unlocked: true,
  unlockedAt: '2026-11-05T12:00:00.000Z',
  source: { type: 'GAME', gameId: GAME_ID },
};
const regular: UserAchievement = {
  code: 'games_10',
  title: 'Regular',
  description: 'Play 10 games.',
  unlocked: true,
  unlockedAt: '2026-10-01T09:00:00.000Z',
  source: { type: 'BACKFILL', gameId: null },
};
const explorer: UserAchievement = {
  code: 'explorer_3',
  title: 'Explorer',
  description: 'Play 3 sports.',
  unlocked: false,
  unlockedAt: null,
  source: null,
};

const unlock: AchievementUnlock = {
  user: user('dev-alex'),
  achievement: { code: 'first_win', title: 'First win', description: 'Win a game.' },
  unlockedAt: '2026-11-05T12:00:00.000Z',
  source: { type: 'GAME', gameId: GAME_ID },
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
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
  jest.resetAllMocks();
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

describe('BadgeStrip', () => {
  it('summarises unlocked badges and marks locked ones', async () => {
    api.getUserAchievements.mockResolvedValue([firstWin, regular, explorer]);
    await renderWithClient(<BadgeStrip username="dev-sam" />);

    const strip = await screen.findByLabelText('Achievements, 2 of 3 unlocked');
    expect(within(strip).getByText('2/3')).toBeTruthy();
    expect(screen.getByTestId('badge-strip-first_win').props.accessibilityLabel).toBe(
      'First win, unlocked',
    );
    expect(screen.getByTestId('badge-strip-explorer_3').props.accessibilityLabel).toBe(
      'Explorer, locked',
    );
    expect(api.getUserAchievements).toHaveBeenCalledWith('dev-sam');
  });

  it("opens that user's achievements page", async () => {
    api.getUserAchievements.mockResolvedValue([firstWin, explorer]);
    await renderWithClient(<BadgeStrip username="dev-sam" />);
    await fireEvent.press(await screen.findByLabelText('Achievements, 1 of 2 unlocked'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/achievements/[username]',
      params: { username: 'dev-sam' },
    });
  });

  it('stays usable when the badges fail to load', async () => {
    api.getUserAchievements.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    await renderWithClient(<BadgeStrip username="dev-sam" />);
    expect(await screen.findByText("Couldn't load badges.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Achievements'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/achievements/[username]',
      params: { username: 'dev-sam' },
    });
  });
});

describe('ProfileScreen badge strip', () => {
  beforeEach(() => {
    api.getUserStats.mockResolvedValue([stats]);
    api.getUserGames.mockResolvedValue([game]);
    api.getUserRivalries.mockResolvedValue([]);
    api.getUserAchievements.mockResolvedValue([firstWin, explorer]);
  });

  it('shows the strip on your own profile', async () => {
    api.getUser.mockResolvedValue(user('dev-alex'));
    await renderWithClient(<ProfileScreen username="dev-alex" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByLabelText('Achievements, 1 of 2 unlocked'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/achievements/[username]',
      params: { username: 'dev-alex' },
    });
  });

  it("shows the profile owner's badges, not the viewer's, on another profile", async () => {
    api.getUser.mockResolvedValue(user('dev-sam'));
    await renderWithClient(<ProfileScreen username="dev-sam" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByLabelText('Achievements, 1 of 2 unlocked'));
    expect(api.getUserAchievements).toHaveBeenCalledWith('dev-sam');
    expect(api.getUserAchievements).not.toHaveBeenCalledWith('dev-alex');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/achievements/[username]',
      params: { username: 'dev-sam' },
    });
  });
});

describe('AchievementsScreen', () => {
  it('groups unlocked badges (with dates) before locked ones', async () => {
    api.getUserAchievements.mockResolvedValue([explorer, firstWin, regular]);
    await renderWithClient(<AchievementsScreen username="dev-sam" />);

    expect(await screen.findByText('UNLOCKED (2)')).toBeTruthy();
    expect(screen.getByText('LOCKED (1)')).toBeTruthy();
    expect(screen.getByText('dev-sam · 2/3 unlocked')).toBeTruthy();
    const rows = screen.getAllByTestId(/^achievement-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'achievement-first_win',
      'achievement-games_10',
      'achievement-explorer_3',
    ]);
    const row = (code: string) => within(screen.getByTestId(`achievement-${code}`));
    expect(row('first_win').getByText('Unlocked Nov 5, 2026')).toBeTruthy();
    expect(row('games_10').getByText('Unlocked Oct 1, 2026')).toBeTruthy();
    expect(row('explorer_3').getByText('Locked')).toBeTruthy();
  });

  it('links an unlock to its visible source game only', async () => {
    api.getUserAchievements.mockResolvedValue([firstWin, regular, explorer]);
    await renderWithClient(<AchievementsScreen username="dev-sam" />);
    expect(await screen.findAllByLabelText('View game')).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText('View game'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/games/[id]',
      params: { id: GAME_ID },
    });
  });

  it('shows an empty unlocked section message when nothing is earned yet', async () => {
    api.getUserAchievements.mockResolvedValue([explorer]);
    await renderWithClient(<AchievementsScreen username="dev-sam" />);
    expect(await screen.findByText('LOCKED (1)')).toBeTruthy();
    expect(screen.getByText('No badges unlocked yet.')).toBeTruthy();
  });
});

describe('FeedScreen recent unlocks', () => {
  beforeEach(() => {
    api.getUserStats.mockResolvedValue([stats]);
    api.getUserGames.mockResolvedValue([game]);
  });

  it('lists your recent unlocks and opens your achievements page', async () => {
    api.getRecentAchievements.mockResolvedValue([unlock]);
    await renderWithClient(<FeedScreen />);

    expect(await screen.findByText('RECENT BADGES')).toBeTruthy();
    const row = screen.getByTestId('recent-unlock-first_win');
    expect(within(row).getByText('First win')).toBeTruthy();
    expect(api.getRecentAchievements).toHaveBeenCalledWith({ pageSize: 5 });

    await fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/achievements/[username]',
      params: { username: 'dev-alex' },
    });
  });

  it('omits the section when there are no unlocks', async () => {
    api.getRecentAchievements.mockResolvedValue([]);
    await renderWithClient(<FeedScreen />);
    expect(await screen.findByText('YOUR HISTORY')).toBeTruthy();
    expect(screen.queryByText('RECENT BADGES')).toBeNull();
  });

  it('shows unlocks even before any game was played', async () => {
    api.getUserStats.mockResolvedValue([]);
    api.getUserGames.mockResolvedValue([]);
    api.getRecentAchievements.mockResolvedValue([
      {
        ...unlock,
        achievement: {
          code: 'first_group_joined',
          title: 'Squad up',
          description: 'Join a group.',
        },
        source: { type: 'GROUP', gameId: null },
      },
    ]);
    await renderWithClient(<FeedScreen />);
    expect(await screen.findByText('RECENT BADGES')).toBeTruthy();
    expect(screen.getByText('Squad up')).toBeTruthy();
    expect(screen.queryByText(EMPTY_FEED_TEXT)).toBeNull();
  });
});
