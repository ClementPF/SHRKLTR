import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, RivalryStats, Stats, Tournament, User } from '@/api/types';
import { ProfileScreen } from '@/features/feed/profile-screen';
import { GAME_NOT_FOUND_TEXT, GameDetailScreen } from '@/features/games/game-detail-screen';
import { groupKeys } from '@/features/groups/queries';
import {
  TOURNAMENT_NOT_FOUND_TEXT,
  TournamentScreen,
} from '@/features/tournaments/tournament-screen';
import { tournamentKeys } from '@/features/tournaments/queries';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);

const GROUP_ID = '5ea0c0de-0000-4000-8000-000000000001';

const user = (username: string): User => ({
  id: `id-${username}`,
  username,
  accountType: 'REGISTERED',
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const cup: Tournament = {
  id: 't-cup',
  name: 'sharktankcup',
  displayName: 'Shark Tank Cup',
  isOver: false,
  sport: { id: 's-darts', name: 'darts' },
  owner: null,
  group: { id: GROUP_ID, name: 'Shark Tank' },
};

const counts = {
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
};

const stat = (username: string, score: number): Stats => ({
  ...counts,
  id: `st-${username}`,
  user: user(username),
  tournament: cup,
  score,
  bestRivalry: null,
  worstRivalry: null,
});

const rivalry = (username: string, rival: string, score: number): RivalryStats => ({
  ...counts,
  id: `r-${username}-${rival}`,
  user: user(username),
  rival: user(rival),
  tournament: cup,
  score,
});

const privateGame: Game = {
  id: 'g-private',
  date: new Date(Date.now() - 3_600_000).toISOString(),
  tournament: cup,
  outcomes: [
    { id: 'o1', result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: user('dev-sam') },
    { id: 'o2', result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: user('dev-jordan') },
  ],
};

const tournamentNotFound = () => new ApiError(404, 'TOURNAMENT_NOT_FOUND', 'Tournament not found');
const gameNotFound = () => new ApiError(404, 'GAME_NOT_FOUND', 'Game not found');

let client: QueryClient;

function renderWithClient(ui: ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Pull-to-refresh on a mounted list. */
async function pullToRefresh(testID: string) {
  const { refreshControl } = screen.getByTestId(testID).props;
  await act(async () => {
    await refreshControl.props.onRefresh();
  });
}

const originalRaf = globalThis.requestAnimationFrame;
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0;
});
afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf;
});

beforeEach(() => {
  jest.resetAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  api.getGame.mockResolvedValue(privateGame);
  api.getRivalry.mockResolvedValue(null as never);
  api.getTournamentStats.mockResolvedValue([stat('dev-sam', 1016), stat('dev-jordan', 984)]);
  api.getTournamentGames.mockResolvedValue([privateGame]);
  api.getUser.mockResolvedValue(user('dev-sam'));
  api.getUserAchievements.mockResolvedValue([]);
});

afterEach(() => client.clear());

/** Everything the server answers once the viewer was removed from the group. */
function loseMembership() {
  api.getGame.mockRejectedValue(gameNotFound());
  api.getTournamentStats.mockRejectedValue(tournamentNotFound());
  api.getTournamentGames.mockRejectedValue(tournamentNotFound());
  api.getStats.mockRejectedValue(tournamentNotFound());
  api.getUserRivalries.mockRejectedValue(tournamentNotFound());
  api.getUserGames.mockRejectedValue(tournamentNotFound());
}

describe('losing access to a private tournament', () => {
  it('shows not-found on the game below once its tournament refresh is denied', async () => {
    // A stack keeps the game screen mounted under the tournament opened from it.
    await renderWithClient(
      <View>
        <GameDetailScreen id={privateGame.id} viewer="dev-sam" />
        <TournamentScreen name={cup.name} viewer="dev-sam" />
      </View>,
    );
    expect(await screen.findByTestId('game-detail-g-private')).toBeTruthy();
    expect(await screen.findByText('RANKING')).toBeTruthy();

    loseMembership();
    await pullToRefresh('tournament-list');

    expect(await screen.findByText(TOURNAMENT_NOT_FOUND_TEXT)).toBeTruthy();
    // Back on the game: the cached private result must not be shown any more.
    expect(await screen.findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('game-detail-g-private')).toBeNull();
    expect(screen.queryByText('dev-jordan')).toBeNull();
  });

  it('drops cached data of the group and its tournament when the game itself is denied', async () => {
    client.setQueryData(groupKeys.members(GROUP_ID), { pages: [[]], pageParams: [0] });
    client.setQueryData(tournamentKeys.stats(cup.name), [stat('dev-sam', 1016)]);
    await renderWithClient(<GameDetailScreen id={privateGame.id} viewer="dev-sam" />);
    expect(await screen.findByTestId('game-detail-g-private')).toBeTruthy();

    loseMembership();
    await act(async () => {
      await client.refetchQueries({ type: 'active' });
    });

    expect(await screen.findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    await waitFor(() =>
      expect(client.getQueryData(tournamentKeys.stats(cup.name))).toBeUndefined(),
    );
    expect(client.getQueryData(groupKeys.members(GROUP_ID))).toBeUndefined();
  });

  it('stops showing a loaded tournament-scoped profile once its refetch is denied', async () => {
    api.getStats.mockResolvedValue(stat('dev-sam', 1016));
    api.getUserRivalries.mockResolvedValue([
      rivalry('dev-sam', 'dev-jordan', 16),
      rivalry('dev-sam', 'dev-alex', -8),
    ]);
    api.getUserGames.mockResolvedValue([privateGame]);

    // Game -> its tournament -> a player's profile in that tournament, all kept mounted.
    await renderWithClient(
      <View>
        <GameDetailScreen id={privateGame.id} viewer="dev-alex" />
        <TournamentScreen name={cup.name} viewer="dev-alex" />
        <ProfileScreen username="dev-sam" tournamentName={cup.name} viewer="dev-alex" />
      </View>,
    );
    expect(await screen.findByText('SHARKS')).toBeTruthy();
    expect(screen.getByText('GAME HISTORY')).toBeTruthy();
    expect(await screen.findByText('RANKING')).toBeTruthy();
    expect(await screen.findByTestId('game-detail-g-private')).toBeTruthy();

    loseMembership();
    await pullToRefresh('profile-list');

    // The profile and, back below it, the tournament both show not-found.
    await waitFor(() => expect(screen.getAllByText(TOURNAMENT_NOT_FOUND_TEXT)).toHaveLength(2));
    expect(screen.queryByText('SHARKS')).toBeNull();
    expect(screen.queryByText('FISHES')).toBeNull();
    expect(screen.queryByText('GAME HISTORY')).toBeNull();
    expect(screen.queryByText('dev-jordan: 16')).toBeNull();
    expect(screen.queryByText('RANKING')).toBeNull();
    // Further back, the game does not show its cached private result either.
    expect(await screen.findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
  });

  it('settles without refetch loops when a never-loaded tournament and game are denied', async () => {
    loseMembership();
    await renderWithClient(
      <View>
        <GameDetailScreen id={privateGame.id} viewer="dev-sam" />
        <TournamentScreen name={cup.name} viewer="dev-sam" />
        <ProfileScreen username="dev-sam" tournamentName={cup.name} viewer="dev-alex" />
      </View>,
    );
    expect(await screen.findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    expect(await screen.findAllByText(TOURNAMENT_NOT_FOUND_TEXT)).toHaveLength(2);

    const calls = () =>
      [api.getGame, api.getTournamentStats, api.getTournamentGames, api.getUserGames].map(
        (fn) => fn.mock.calls.length,
      );
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const settled = calls();
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(calls()).toEqual(settled);
    expect(Math.max(...settled)).toBeLessThanOrEqual(4);
  });
});
