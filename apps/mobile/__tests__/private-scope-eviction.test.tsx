import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, Group, GroupMember, RivalryStats, Stats, Tournament, User } from '@/api/types';
import { ProfileScreen } from '@/features/feed/profile-screen';
import { AddPlayers } from '@/features/game-form/add-players';
import { useGameFormStore } from '@/features/game-form/store';
import { GAME_NOT_FOUND_TEXT, GameDetailScreen } from '@/features/games/game-detail-screen';
import { GROUP_NOT_FOUND_TEXT } from '@/features/groups/group-parts';
import { GroupInviteScreen, INVITE_MANAGERS_ONLY_TEXT } from '@/features/groups/invite-screen';
import { groupKeys } from '@/features/groups/queries';
import {
  TOURNAMENT_NOT_FOUND_TEXT,
  TournamentScreen,
} from '@/features/tournaments/tournament-screen';
import { tournamentKeys } from '@/features/tournaments/queries';
import { statsKeys, userKeys } from '@/features/users/queries';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ value }: { value: string }) => <Text testID="qr-svg">{value}</Text>,
  };
});

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

describe('losing access through a group subquery', () => {
  const groupNotFound = () => new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
  const roleRequired = () =>
    new ApiError(403, 'GROUP_ROLE_REQUIRED', 'Only owners and admins can do this');

  const summary = (role: Group['role']): Group => ({
    id: GROUP_ID,
    name: 'Shark Tank',
    role,
    memberCount: 3,
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  const members: GroupMember[] = ['dev-alex', 'dev-sam', 'dev-jordan'].map((username) => ({
    user: user(username),
    role: username === 'dev-alex' ? 'OWNER' : 'MEMBER',
    joinedAt: '2026-11-01T00:00:00.000Z',
  }));

  const feedKey = userKeys.games('dev-sam', undefined, 20);
  const scopedStatsKey = statsKeys.tournament('dev-sam', cup.name);

  /** Matches the app's 30 s freshness: the cached group summary is not refetched meanwhile. */
  function useAppFreshness() {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: 30_000 },
        mutations: { gcTime: Infinity },
      },
    });
  }

  /** Private data cached while the viewer was still a member, held by no mounted screen. */
  function cacheInactivePrivateData() {
    client.setQueryData(groupKeys.tournaments(GROUP_ID), [cup]);
    client.setQueryData(feedKey, { pages: [[privateGame]], pageParams: [0] });
    client.setQueryData(scopedStatsKey, stat('dev-sam', 1016));
  }

  function expectInactivePrivateDataEvicted() {
    return waitFor(() => {
      expect(client.getQueryData(feedKey)).toBeUndefined();
      expect(client.getQueryData(scopedStatsKey)).toBeUndefined();
      expect(client.getQueryData(groupKeys.tournaments(GROUP_ID))).toBeUndefined();
    });
  }

  /** Game -> its tournament -> grouped game entry for that tournament, all kept mounted. */
  async function openGroupedGameEntry() {
    useGameFormStore.setState({
      owner: 'dev-sam',
      tournament: cup,
      outcomes: [{ username: 'dev-sam', result: 'WIN' }],
    });
    await renderWithClient(
      <View>
        <GameDetailScreen id={privateGame.id} viewer="dev-sam" />
        <TournamentScreen name={cup.name} viewer="dev-sam" />
        <AddPlayers ownerId="id-dev-sam" />
      </View>,
    );
    expect(await screen.findByTestId('game-detail-g-private')).toBeTruthy();
    expect(await screen.findByText('RANKING')).toBeTruthy();
  }

  async function expectGroupedGameEntryDenied() {
    expect(await screen.findByTestId('player-search-denied')).toHaveTextContent(
      TOURNAMENT_NOT_FOUND_TEXT,
    );
    expect(screen.queryByText(/Couldn't load players/)).toBeNull();
    // Mounted screens further back stop showing their cached private results.
    expect(await screen.findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('game-detail-g-private')).toBeNull();
    expect(screen.queryByText('RANKING')).toBeNull();
    await expectInactivePrivateDataEvicted();
  }

  beforeEach(() => {
    useAppFreshness();
    api.getGroup.mockResolvedValue(summary('ADMIN'));
  });

  it('evicts private data and shows not-found when the member list is denied in game entry', async () => {
    cacheInactivePrivateData();
    await openGroupedGameEntry();

    loseMembership();
    api.listGroupMembers.mockRejectedValue(groupNotFound());
    api.listGroupPlayers.mockRejectedValue(groupNotFound());
    await fireEvent.changeText(screen.getByLabelText('Find a player'), 'dev');

    await expectGroupedGameEntryDenied();
    // The refused list is not refetched by its own eviction.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(api.listGroupMembers).toHaveBeenCalledTimes(1);
  });

  it('evicts private data and shows not-found when the group roster is denied in game entry', async () => {
    cacheInactivePrivateData();
    await openGroupedGameEntry();

    loseMembership();
    api.listGroupMembers.mockResolvedValue(members);
    api.listGroupPlayers.mockRejectedValue(groupNotFound());
    await fireEvent.changeText(screen.getByLabelText('Find a player'), 'dev');

    await expectGroupedGameEntryDenied();
    expect(screen.queryByLabelText('Add dev-jordan')).toBeNull();
  });

  it('evicts private data and shows not-found when the invite list is denied', async () => {
    cacheInactivePrivateData();
    // The summary still says admin: it was cached moments before the removal.
    client.setQueryData(groupKeys.detail(GROUP_ID), summary('ADMIN'));
    api.getGroup.mockRejectedValue(groupNotFound());
    loseMembershipAfterFirstGameLoad();
    api.listGroupInvites.mockRejectedValue(groupNotFound());

    await renderWithClient(
      <View>
        <GameDetailScreen id={privateGame.id} viewer="dev-sam" />
        <GroupInviteScreen id={GROUP_ID} />
      </View>,
    );

    expect(await screen.findByText(GROUP_NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load the invites/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create invite' })).toBeNull();
    expect(await screen.findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('game-detail-g-private')).toBeNull();
    await expectInactivePrivateDataEvicted();
  });

  it('keeps private data when an admin-only invite read is refused for the role', async () => {
    cacheInactivePrivateData();
    client.setQueryData(groupKeys.detail(GROUP_ID), summary('ADMIN'));
    api.listGroupInvites.mockRejectedValue(roleRequired());

    await renderWithClient(
      <View>
        <GameDetailScreen id={privateGame.id} viewer="dev-sam" />
        <GroupInviteScreen id={GROUP_ID} />
      </View>,
    );

    // Non-404 failures are retried once, after the default one second delay.
    expect(
      await screen.findByText(/Couldn't load the invites/, {}, { timeout: 3000 }),
    ).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByText(GROUP_NOT_FOUND_TEXT)).toBeNull();
    expect(screen.getByTestId('game-detail-g-private')).toBeTruthy();
    expect(api.getGame).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(feedKey)).toBeDefined();
    expect(client.getQueryData(scopedStatsKey)).toBeDefined();
    expect(client.getQueryData(groupKeys.tournaments(GROUP_ID))).toEqual([cup]);
  });

  it('still shows members the managers-only text without evicting anything', async () => {
    cacheInactivePrivateData();
    api.getGroup.mockResolvedValue(summary('MEMBER'));

    await renderWithClient(<GroupInviteScreen id={GROUP_ID} />);

    expect(await screen.findByText(INVITE_MANAGERS_ONLY_TEXT)).toBeTruthy();
    expect(api.listGroupInvites).not.toHaveBeenCalled();
    expect(screen.queryByText(GROUP_NOT_FOUND_TEXT)).toBeNull();
    expect(client.getQueryData(feedKey)).toBeDefined();
    expect(client.getQueryData(groupKeys.tournaments(GROUP_ID))).toEqual([cup]);
  });
});

/** The first game load still succeeds; every later private read is refused. */
function loseMembershipAfterFirstGameLoad() {
  loseMembership();
  api.getGame.mockResolvedValueOnce(privateGame).mockRejectedValue(gameNotFound());
}
