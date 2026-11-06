import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type {
  Game,
  Group,
  GroupMember,
  GroupPlayer,
  RivalryStats,
  Stats,
  Tournament,
  User,
} from '@/api/types';
import GameDetailRoute from '@/app/(app)/games/[id]';
import UserDetailRoute from '@/app/(app)/user/[username]';
import { useSession, type SessionContextValue } from '@/auth/session';
import {
  TOURNAMENT_NOT_FOUND_TEXT,
  TournamentScreen,
} from '@/features/tournaments/tournament-screen';
import { ProfileScreen } from '@/features/feed/profile-screen';
import { GAME_NOT_FOUND_TEXT, GameDetailScreen } from '@/features/games/game-detail-screen';
import { gameKeys } from '@/features/games/queries';
import { GROUP_NOT_FOUND_TEXT } from '@/features/groups/group-parts';
import { GroupScreen } from '@/features/groups/group-screen';
import { GroupMembersScreen } from '@/features/groups/members-screen';
import { groupKeys } from '@/features/groups/queries';
import { tournamentKeys } from '@/features/tournaments/queries';
import { DETAIL_PAGE_SIZE, statsKeys, userKeys } from '@/features/users/queries';

import { makeSession } from '../test-utils/session';

// Screens re-run their focus effects when `refocus()` is called, like returning to a screen.
const mockFocusCallbacks = new Set<() => void>();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    Stack: { Screen: () => null },
    router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() },
    useLocalSearchParams: jest.fn(),
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
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);
const mockedParams = jest.mocked(useLocalSearchParams);

const GROUP_ID = '5ea0c0de-0000-4000-8000-000000000002';

const person = (username: string, accountType: User['accountType'] = 'REGISTERED'): User => ({
  id: `id-${username}`,
  username,
  accountType,
  firstName: username.replace(/^(dev|guest)-/, 'Name '),
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const alex = person('dev-alex');
const sam = person('dev-sam');
const jordan = person('dev-jordan');
const robin = person('guest-robin', 'PLACEHOLDER');

const cup: Tournament = {
  id: 't-cup',
  name: 'sharktankcup',
  displayName: 'Shark Tank Cup',
  isOver: false,
  sport: { id: 's-darts', name: 'darts' },
  owner: null,
  group: { id: GROUP_ID, name: 'Shark Tank' },
};

const summary: Group = {
  id: GROUP_ID,
  name: 'Shark Tank',
  role: 'MEMBER',
  memberCount: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const members: GroupMember[] = [
  { user: alex, role: 'OWNER', joinedAt: '2026-11-01T00:00:00.000Z' },
  { user: sam, role: 'MEMBER', joinedAt: '2026-11-01T00:00:00.000Z' },
  { user: jordan, role: 'MEMBER', joinedAt: '2026-11-01T00:00:00.000Z' },
];
const roster: GroupPlayer[] = [{ user: robin, addedBy: alex, addedAt: '2026-11-01T00:00:00.000Z' }];

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

const stat = (user: User, score: number): Stats => ({
  ...counts,
  id: `st-${user.username}`,
  user,
  tournament: cup,
  score,
  bestRivalry: null,
  worstRivalry: null,
});

const rivalry = (user: User, rival: User, score: number): RivalryStats => ({
  ...counts,
  id: `r-${user.username}-${rival.username}`,
  user,
  rival,
  tournament: cup,
  score,
});

const privateGame: Game = {
  id: 'g-private',
  date: new Date(Date.now() - 3_600_000).toISOString(),
  tournament: cup,
  outcomes: [
    { id: 'o1', result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: alex },
    { id: 'o2', result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: jordan },
  ],
};

const groupNotFound = () => new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
const tournamentNotFound = () => new ApiError(404, 'TOURNAMENT_NOT_FOUND', 'Tournament not found');
const gameNotFound = () => new ApiError(404, 'GAME_NOT_FOUND', 'Game not found');

/** Every read the member could make while still in the group. */
function beAMember() {
  api.getGroup.mockResolvedValue(summary);
  api.listGroupMembers.mockResolvedValue(members);
  api.listGroupTournaments.mockResolvedValue([cup]);
  api.listGroupPlayers.mockResolvedValue(roster);
  api.listInvitedPlayers.mockResolvedValue([]);
  api.getTournamentStats.mockResolvedValue([stat(alex, 1016), stat(jordan, 984)]);
  api.getTournamentGames.mockResolvedValue([privateGame]);
  api.getGame.mockResolvedValue(privateGame);
  api.getRivalry.mockResolvedValue(rivalry(sam, jordan, 16));
  api.getStats.mockResolvedValue(stat(alex, 1016));
  api.getUserRivalries.mockResolvedValue([rivalry(alex, jordan, 16)]);
  api.getUserGames.mockResolvedValue([privateGame]);
  api.getUser.mockResolvedValue(alex);
  api.getUserAchievements.mockResolvedValue([]);
}

/** What the server answers once the member left or was removed. */
function loseAccess() {
  for (const read of [
    api.getGroup,
    api.listGroupMembers,
    api.listGroupTournaments,
    api.listGroupPlayers,
  ]) {
    read.mockRejectedValue(groupNotFound());
  }
  for (const read of [
    api.getTournamentStats,
    api.getTournamentGames,
    api.getRivalry,
    api.getStats,
    api.getUserRivalries,
    api.getUserGames,
  ]) {
    read.mockRejectedValue(tournamentNotFound());
  }
  api.getGame.mockRejectedValue(gameNotFound());
}

/** Private group, tournament, game and scoped-profile data the cache must no longer hold. */
const privateKeys = [
  groupKeys.detail(GROUP_ID),
  groupKeys.members(GROUP_ID),
  groupKeys.tournaments(GROUP_ID),
  groupKeys.players(GROUP_ID),
  tournamentKeys.stats(cup.name),
  tournamentKeys.games(cup.name, DETAIL_PAGE_SIZE),
  gameKeys.detail(privateGame.id),
  statsKeys.tournament(alex.username, cup.name),
  userKeys.rivalries(alex.username, cup.name),
  userKeys.games(alex.username, cup.name, DETAIL_PAGE_SIZE),
];

let client: QueryClient;

function renderWithClient(ui: ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const inScreen = (testID: string) => within(screen.getByTestId(testID));

async function refocus() {
  await act(async () => {
    for (const effect of [...mockFocusCallbacks]) effect();
  });
}

/** Calls to every private read, to check that denial settles instead of refetching forever. */
const readCalls = () =>
  [
    api.getGroup,
    api.listGroupMembers,
    api.listGroupTournaments,
    api.listGroupPlayers,
    api.getTournamentStats,
    api.getTournamentGames,
    api.getGame,
    api.getRivalry,
    api.getStats,
    api.getUserRivalries,
    api.getUserGames,
  ].map((read) => read.mock.calls.length);

async function expectSettled() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  const settled = readCalls();
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  expect(readCalls()).toEqual(settled);
}

function expectNoPrivateData() {
  for (const queryKey of privateKeys) expect(client.getQueryData(queryKey)).toBeUndefined();
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
  mockFocusCallbacks.clear();
  // The app's freshness: cached screens are not refetched on their own for 30 seconds.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 30_000 },
      mutations: { gcTime: Infinity },
    },
  });
  const session = makeSession({ user: sam });
  jest.mocked(useSession).mockReturnValue({
    status: 'authenticated',
    session,
    user: sam,
    loginWithGoogleCode: jest.fn(),
    loginWithDevUser: jest.fn(),
    logout: jest.fn(async () => undefined),
    refresh: jest.fn(),
  } as SessionContextValue);
  mockedParams.mockReturnValue({ id: privateGame.id });
  beAMember();
});

afterEach(() => client.clear());

async function expectGroupLoaded() {
  expect(await inScreen('screen-group').findByTestId('group-name')).toHaveTextContent('Shark Tank');
  expect(await inScreen('screen-group').findByLabelText('Name robin')).toBeTruthy();
}

function expectGroupDenied() {
  const group = inScreen('screen-group');
  expect(group.getByText(GROUP_NOT_FOUND_TEXT)).toBeTruthy();
  expect(group.queryByTestId('group-name')).toBeNull();
  expect(group.queryByText(/members · You are/)).toBeNull();
  expect(group.queryByLabelText('Name alex, Owner')).toBeNull();
  expect(group.queryByLabelText('Name robin')).toBeNull();
  expect(group.queryByText('Shark Tank Cup · darts')).toBeNull();
}

function expectTournamentGameAndProfileDenied() {
  expect(inScreen('screen-tournament').getByText(TOURNAMENT_NOT_FOUND_TEXT)).toBeTruthy();
  expect(inScreen('screen-tournament').queryByText('RANKING')).toBeNull();
  expect(inScreen('screen-game').getByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
  expect(inScreen('screen-game').queryByText('ELO CHANGES')).toBeNull();
  expect(inScreen('screen-profile').getByText(TOURNAMENT_NOT_FOUND_TEXT)).toBeTruthy();
  expect(inScreen('screen-profile').queryByText('GAME HISTORY')).toBeNull();
}

describe('screens kept mounted when membership is lost', () => {
  it('shows not-found on every mounted group screen after leaving through Manage members', async () => {
    api.leaveGroup.mockResolvedValue(undefined);
    // Group -> its tournament -> a game -> a player's tournament profile -> Manage members.
    await renderWithClient(
      <View>
        <View testID="screen-group">
          <GroupScreen id={GROUP_ID} />
        </View>
        <View testID="screen-tournament">
          <TournamentScreen name={cup.name} viewer="dev-sam" />
        </View>
        <View testID="screen-game">
          <GameDetailScreen id={privateGame.id} viewer="dev-sam" />
        </View>
        <View testID="screen-profile">
          <ProfileScreen username="dev-alex" tournamentName={cup.name} viewer="dev-sam" />
        </View>
        <View testID="screen-members">
          <GroupMembersScreen id={GROUP_ID} />
        </View>
      </View>,
    );
    await expectGroupLoaded();
    expect(await inScreen('screen-tournament').findByText('RANKING')).toBeTruthy();
    expect(await inScreen('screen-game').findByText('ELO CHANGES')).toBeTruthy();
    expect(await inScreen('screen-profile').findByText('GAME HISTORY')).toBeTruthy();

    loseAccess();
    await fireEvent.press(await inScreen('screen-members').findByTestId('leave-group'));
    await fireEvent.press(
      within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: 'Leave group' }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/groups'));

    // Back on each screen below, without a reload.
    await waitFor(expectGroupDenied);
    await waitFor(expectTournamentGameAndProfileDenied);
    expectNoPrivateData();
    await expectSettled();
    expectGroupDenied();
    expectTournamentGameAndProfileDenied();
  });

  it('shows not-found everywhere once a removed member returns to a mounted private game', async () => {
    // Group -> its tournament -> a game (the real route) -> a player's tournament profile.
    await renderWithClient(
      <View>
        <View testID="screen-group">
          <GroupScreen id={GROUP_ID} />
        </View>
        <View testID="screen-tournament">
          <TournamentScreen name={cup.name} viewer="dev-sam" />
        </View>
        <View testID="screen-game">
          <GameDetailRoute />
        </View>
        <View testID="screen-profile">
          <ProfileScreen username="dev-alex" tournamentName={cup.name} viewer="dev-sam" />
        </View>
      </View>,
    );
    await expectGroupLoaded();
    expect(await inScreen('screen-game').findByText('ELO CHANGES')).toBeTruthy();
    expect(await inScreen('screen-profile').findByText('GAME HISTORY')).toBeTruthy();

    // An admin removes the member; nothing tells this device until a read is refused.
    loseAccess();
    await refocus();

    await waitFor(expectTournamentGameAndProfileDenied);
    await waitFor(expectGroupDenied);
    expectNoPrivateData();
    await expectSettled();
  });

  it('revalidates a mounted tournament profile when its route is focused again', async () => {
    mockedParams.mockReturnValue({ username: alex.username, tournamentName: cup.name });
    await renderWithClient(
      <View testID="screen-profile">
        <UserDetailRoute />
      </View>,
    );
    expect(await screen.findByText('GAME HISTORY')).toBeTruthy();

    loseAccess();
    await refocus();

    expect(await screen.findByText(TOURNAMENT_NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByText('GAME HISTORY')).toBeNull();
    expect(client.getQueryData(userKeys.games(alex.username, cup.name, DETAIL_PAGE_SIZE))).toBe(
      undefined,
    );
  });

  it('treats a rivalry refused for its tournament as losing the cached game', async () => {
    function Stack({ withGame }: { withGame: boolean }) {
      return (
        <View>
          <View testID="screen-profile">
            <ProfileScreen username="dev-alex" tournamentName={cup.name} viewer="dev-sam" />
          </View>
          {withGame && (
            <View testID="screen-game">
              <GameDetailScreen id={privateGame.id} viewer="dev-sam" />
            </View>
          )}
        </View>
      );
    }
    // The game was cached moments ago, so opening it again does not refetch it.
    client.setQueryData(gameKeys.detail(privateGame.id), privateGame);
    const view = await renderWithClient(<Stack withGame={false} />);
    expect(await screen.findByText('GAME HISTORY')).toBeTruthy();

    loseAccess();
    await view.rerender(
      <QueryClientProvider client={client}>
        <Stack withGame />
      </QueryClientProvider>,
    );

    // Only the live rivalry is read on opening; its refusal hides the game and the profile.
    expect(await inScreen('screen-game').findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    expect(inScreen('screen-game').queryByText('ELO CHANGES')).toBeNull();
    expect(await inScreen('screen-profile').findByText(TOURNAMENT_NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByText('GAME HISTORY')).toBeNull();
    expect(client.getQueryData(gameKeys.detail(privateGame.id))).toBeUndefined();
    await expectSettled();
  });

  it('keeps showing a game whose players simply never met in that tournament', async () => {
    api.getRivalry.mockRejectedValue(new ApiError(404, 'RIVALRY_NOT_FOUND', 'Rivalry not found'));
    await renderWithClient(<GameDetailScreen id={privateGame.id} viewer="dev-sam" />);

    expect(await screen.findByText(/^No rivalry between /)).toBeTruthy();
    expect(screen.getByTestId('game-detail-g-private')).toBeTruthy();
    expect(screen.queryByText(GAME_NOT_FOUND_TEXT)).toBeNull();
    expect(api.getGame).toHaveBeenCalledTimes(1);
  });
});
