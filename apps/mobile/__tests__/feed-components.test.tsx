import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, RivalryStats, Stats, Tournament, User } from '@/api/types';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import { GameRow, rivalryPairs } from '@/components/game-row';
import { RivalryDonut } from '@/components/rivalry-donut';
import { StatsCard } from '@/components/stats-card';
import { ProfileScreen } from '@/features/feed/profile-screen';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);

const user = (username: string): User => ({
  id: `id-${username}`,
  username,
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

const zeroStats = {
  bestScore: 1000,
  worstScore: 1000,
  gameCount: 0,
  winCount: 0,
  loseCount: 0,
  tieCount: 0,
  winStreak: 0,
  loseStreak: 0,
  tieStreak: 0,
  longestWinStreak: 0,
  longestLoseStreak: 0,
  longestTieStreak: 0,
};

function rivalry(username: string, rival: string, score: number): RivalryStats {
  return {
    ...zeroStats,
    id: `r-${username}-${rival}`,
    user: user(username),
    rival: user(rival),
    tournament,
    score,
    gameCount: 3,
    winCount: 2,
    loseCount: 1,
    winStreak: 1,
  };
}

const stats: Stats = {
  ...zeroStats,
  id: 'st1',
  user: user('dev-sam'),
  tournament,
  score: 1041.6,
  bestScore: 1050.2,
  gameCount: 7,
  winCount: 4,
  winStreak: 2,
  longestWinStreak: 3,
  longestLoseStreak: 1,
  bestRivalry: rivalry('dev-sam', 'dev-jordan', 30.4),
  worstRivalry: null,
};

const game: Game = {
  id: 'g1',
  date: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  tournament,
  outcomes: [
    { id: 'o1', result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: user('dev-alex') },
    { id: 'o2', result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: user('dev-sam') },
  ],
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    // gcTime Infinity on both caches: GC timers would keep jest alive after the run.
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

// jest's requestAnimationFrame fires every tick, so the donut sweep would flood the tests with
// state updates; charts are asserted on their final, non-animated content instead.
const originalRaf = globalThis.requestAnimationFrame;
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0;
});
afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf;
});

beforeEach(() => {
  jest.resetAllMocks();
  useAlertStore.setState({ current: null });
});

describe('StatsCard', () => {
  it('shows score, streaks and the best/worst rivalry rows', async () => {
    await render(<StatsCard stats={stats} />);
    expect(screen.getByText('Office Babyfoot')).toBeTruthy();
    expect(screen.getByText('1042')).toBeTruthy();
    expect(screen.getByText('1050')).toBeTruthy();
    expect(screen.getByText('Current Winning Streak')).toBeTruthy();
    expect(screen.getByText('The Smelly Fish')).toBeTruthy();
    expect(screen.getByText('dev-jordan (30)')).toBeTruthy();
    expect(screen.getByText('The Freaking Shark')).toBeTruthy();
    expect(screen.getByText('❌🦈')).toBeTruthy();
  });
});

describe('GameRow', () => {
  it('shows the relative date, points at stake and both teams', async () => {
    await renderWithClient(<GameRow game={game} viewer="dev-sam" />);
    expect(screen.getByText('2 hours ago')).toBeTruthy();
    expect(screen.getByTestId('game-points')).toHaveTextContent('16');
    expect(screen.getByText('dev-alex')).toBeTruthy();
    expect(screen.getByText('dev-sam')).toBeTruthy();
    expect(screen.getByText('VS')).toBeTruthy();
  });

  it('loads the live rivalry when expanded and hides it again on a second tap', async () => {
    api.getRivalry.mockResolvedValue(rivalry('dev-sam', 'dev-alex', -42.3));
    await renderWithClient(<GameRow game={game} viewer="dev-sam" />);
    expect(screen.queryByTestId('game-rivalry')).toBeNull();

    await fireEvent.press(screen.getByTestId('game-row-g1'));
    expect(await screen.findByText('Total Points')).toBeTruthy();
    expect(screen.getByText('-42')).toBeTruthy();
    expect(api.getRivalry).toHaveBeenCalledWith('dev-sam', 'dev-alex', 'officebabyfoot');

    await fireEvent.press(screen.getByTestId('game-row-g1'));
    expect(screen.queryByTestId('game-rivalry')).toBeNull();
  });

  it('shows a notice when the two players have no rivalry yet', async () => {
    api.getRivalry.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'nope'));
    await renderWithClient(<GameRow game={game} />);
    await fireEvent.press(screen.getByTestId('game-row-g1'));
    expect(
      await screen.findByText('NO RIVALRY BETWEEN dev-alex AND dev-sam FOR officebabyfoot'),
    ).toBeTruthy();
  });

  it('pairs the viewer (or the first winner) with every opponent', () => {
    expect(rivalryPairs(game, 'dev-sam')).toEqual([{ username: 'dev-sam', rivalName: 'dev-alex' }]);
    expect(rivalryPairs(game, 'someone-else')).toEqual([
      { username: 'dev-alex', rivalName: 'dev-sam' },
    ]);
  });
});

describe('RivalryDonut', () => {
  it('draws one SVG circle per slice with "rival: score" labels', async () => {
    await render(
      <RivalryDonut
        animate={false}
        slices={[
          { key: 'a', label: 'dev-morgan: -17', value: 17 },
          { key: 'b', label: 'dev-jordan: -4', value: 4 },
        ]}
      />,
    );
    expect(screen.getByText('dev-morgan: -17')).toBeTruthy();
    expect(screen.getByText('dev-jordan: -4')).toBeTruthy();
  });
});

describe('ProfileScreen (tournament user detail)', () => {
  beforeEach(() => {
    api.getStats.mockResolvedValue(stats);
    api.getUserRivalries.mockResolvedValue([
      rivalry('dev-sam', 'dev-alex', -20.2),
      rivalry('dev-sam', 'dev-jordan', 30.4),
      rivalry('dev-sam', 'dev-taylor', -5.1),
    ]);
    api.getUserGames.mockResolvedValue([game]);
  });

  async function renderDetail() {
    await renderWithClient(
      <ProfileScreen username="dev-sam" tournamentName="officebabyfoot" viewer="dev-alex" />,
    );
    await screen.findByText('SHARKS');
  }

  it('renders the tile, stats, SHARKS / FISHES charts and the tournament history', async () => {
    await renderDetail();
    expect(screen.getByText('WINS')).toBeTruthy();
    expect(screen.getByText('GAMES')).toBeTruthy();
    expect(screen.getByText('STATS')).toBeTruthy();
    expect(screen.getByText('FISHES')).toBeTruthy();
    expect(screen.getByText('dev-alex: -20')).toBeTruthy();
    expect(screen.getByText('dev-taylor: -5')).toBeTruthy();
    expect(api.getStats).toHaveBeenCalledWith('dev-sam', 'officebabyfoot');
    expect(api.getUserGames).toHaveBeenCalledWith(
      'dev-sam',
      { page: 0, pageSize: 10, tournamentName: 'officebabyfoot' },
      expect.anything(),
    );
  });

  it('shows the challenged state after a successful challenge', async () => {
    api.challengeUser.mockResolvedValue(undefined);
    await renderDetail();
    await fireEvent.press(screen.getByLabelText('Challenge dev-sam'));
    expect(await screen.findByTestId('challenged-state')).toBeTruthy();
    expect(api.challengeUser).toHaveBeenCalledWith('dev-sam', 'I demand a trial by combat.');
  });

  it('alerts when the challenged user has no push token', async () => {
    api.challengeUser.mockRejectedValue(new ApiError(400, 'NO_PUSH_TOKEN', 'no token'));
    await renderDetail();
    await fireEvent.press(screen.getByLabelText('Challenge dev-sam'));
    expect(
      await screen.findByText(
        "Challenge failed, dev-sam doesn't have push notification turned on.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('challenged-state')).toBeNull();
  });

  it('does not offer a challenge on your own profile', async () => {
    api.getUserStats.mockResolvedValue([stats]);
    await renderWithClient(<ProfileScreen username="dev-sam" viewer="dev-sam" />);
    expect(await screen.findByText('STATS')).toBeTruthy();
    expect(screen.queryByLabelText('Challenge dev-sam')).toBeNull();
    expect(screen.queryByText('SHARKS')).toBeNull();
  });
});
