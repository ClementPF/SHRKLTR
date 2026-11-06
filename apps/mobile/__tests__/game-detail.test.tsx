import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import dayjs from 'dayjs';
import { router } from 'expo-router';
import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, Tournament, User } from '@/api/types';
import AppLayout, { unstable_settings } from '@/app/(app)/_layout';
import { historyItems, renderListItem } from '@/features/feed/list-items';
import { GameResultScreen } from '@/features/game-form/result-screen';
import {
  GAME_LOAD_FAILED_TEXT,
  GAME_NOT_FOUND_TEXT,
  GameDetailScreen,
} from '@/features/games/game-detail-screen';
import { gameKeys, openGame } from '@/features/games/queries';
import { deferred } from '../test-utils/session';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => {
  const Screen = jest.fn(() => null);
  const Stack = Object.assign(
    jest.fn(({ children }: { children?: ReactNode }) => children ?? null),
    { Screen },
  );
  return {
    Stack,
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);
const mockedRouter = jest.mocked(router);

const user = (username: string, accountType: User['accountType'] = 'REGISTERED'): User => ({
  id: `id-${username}`,
  username,
  accountType,
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const babyfoot: Tournament = {
  id: 't1',
  name: 'officebabyfoot',
  displayName: 'Office Babyfoot',
  isOver: false,
  sport: { id: 's1', name: 'babyfoot' },
  owner: null,
};

const darts: Tournament = {
  ...babyfoot,
  id: 't2',
  name: 'lunchdarts',
  displayName: 'Lunch Darts',
  sport: { id: 's2', name: 'darts' },
};

const DATE = '2026-11-03T18:30:00.000Z';

const game1: Game = {
  id: 'g1',
  date: DATE,
  tournament: babyfoot,
  outcomes: [
    {
      id: 'o1',
      result: 'WIN',
      scoreValue: 15.71,
      ratingBefore: 1000,
      user: user('guest-pat', 'PLACEHOLDER'),
    },
    { id: 'o2', result: 'LOSS', scoreValue: -15.71, ratingBefore: 993.66, user: user('dev-alex') },
  ],
};

const game2: Game = {
  id: 'g2',
  date: DATE,
  tournament: darts,
  outcomes: [
    { id: 'o3', result: 'WIN', scoreValue: 16, ratingBefore: null, user: user('dev-jordan') },
    { id: 'o4', result: 'LOSS', scoreValue: -16, ratingBefore: null, user: user('dev-sam') },
  ],
};

let client: QueryClient;

function renderWithClient(ui: ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getGame.mockReset();
  api.getRivalry.mockResolvedValue(null as never);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
});

describe('GameDetailScreen', () => {
  it('shows a spinner while the game loads, then the fetched game', async () => {
    const pending = deferred<Game>();
    api.getGame.mockReturnValue(pending.promise);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);

    expect(screen.getByTestId('game-detail-loading')).toBeTruthy();
    expect(screen.queryByText('Office Babyfoot')).toBeNull();
    expect(api.getGame).toHaveBeenCalledWith('g1', expect.anything());

    pending.resolve(game1);
    expect(await screen.findByText('Office Babyfoot')).toBeTruthy();
    expect(screen.getByText('babyfoot')).toBeTruthy();
    expect(screen.getByText(dayjs(DATE).format('ddd D MMM YYYY, HH:mm'))).toBeTruthy();
    expect(screen.getByTestId('game-detail-outcomes-winners')).toHaveTextContent(
      /guest-pat \+15\.7/,
    );
    expect(screen.getByTestId('game-detail-outcomes-losers')).toHaveTextContent(/dev-alex -15\.7/);
    expect(screen.getByTestId('outcome-guest-pat')).toHaveTextContent(/WIN.*1000 → 1016.*\+15\.7/);
    expect(screen.getByTestId('outcome-guest-pat')).toHaveTextContent(/UNCLAIMED/);
    expect(screen.getByTestId('outcome-dev-alex')).toHaveTextContent(/LOSS.*994 → 978.*-15\.7/);
  });

  it('shows only the Elo change when the pre-game rating was not recorded', async () => {
    api.getGame.mockResolvedValue(game2);
    await renderWithClient(<GameDetailScreen id="g2" />);
    expect(await screen.findByTestId('outcome-dev-jordan')).toHaveTextContent(/WIN.*\+16\.0/);
    expect(screen.getByTestId('outcome-dev-jordan')).not.toHaveTextContent(/→/);
  });

  it('never shows the previous game while a different id loads', async () => {
    api.getGame.mockResolvedValueOnce(game1);
    const view = await renderWithClient(<GameDetailScreen id="g1" />);
    expect(await screen.findByText('Office Babyfoot')).toBeTruthy();

    const pending = deferred<Game>();
    api.getGame.mockReturnValueOnce(pending.promise);
    await view.rerender(
      <QueryClientProvider client={client}>
        <GameDetailScreen id="g2" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('game-detail-loading')).toBeTruthy();
    expect(screen.queryByText('Office Babyfoot')).toBeNull();
    expect(api.getGame).toHaveBeenLastCalledWith('g2', expect.anything());

    pending.resolve(game2);
    expect(await screen.findByText('Lunch Darts')).toBeTruthy();
    expect(screen.queryByText('Office Babyfoot')).toBeNull();
  });

  it('shows an error with a retry that refetches the requested id', async () => {
    api.getGame.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    api.getGame.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await renderWithClient(<GameDetailScreen id="g1" />);
    expect(await screen.findByText(GAME_LOAD_FAILED_TEXT, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText('Office Babyfoot')).toBeNull();

    api.getGame.mockResolvedValue(game1);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Office Babyfoot')).toBeTruthy();
    expect(api.getGame).toHaveBeenLastCalledWith('g1', expect.anything());
  });

  it.each([
    ['unknown id', new ApiError(404, 'GAME_NOT_FOUND', 'Game not found')],
    ['malformed id', new ApiError(400, 'VALIDATION_ERROR', 'params/id Invalid UUID')],
  ])('shows a not-found state for an %s without retrying', async (_, error) => {
    api.getGame.mockRejectedValue(error);
    await renderWithClient(<GameDetailScreen id="missing" />);
    expect(await screen.findByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    expect(api.getGame).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByLabelText('Back to feed'));
    expect(mockedRouter.navigate).toHaveBeenCalledWith('/feed');
  });

  it('renders the actions slot and the footer below the game', async () => {
    api.getGame.mockResolvedValue(game1);
    await renderWithClient(
      <GameDetailScreen id="g1" actions={<Text>SHARE SLOT</Text>} footer={<Text>FOOTER</Text>} />,
    );
    expect(await screen.findByText('SHARE SLOT')).toBeTruthy();
    expect(screen.getByText('FOOTER')).toBeTruthy();
  });

  it('opens the tournament and player profiles from the detail', async () => {
    api.getGame.mockResolvedValue(game1);
    await renderWithClient(<GameDetailScreen id="g1" />);
    await fireEvent.press(await screen.findByLabelText('Open tournament Office Babyfoot'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/tournament/[name]',
      params: { name: 'officebabyfoot', displayName: 'Office Babyfoot' },
    });
    await fireEvent.press(screen.getByLabelText('Open dev-alex'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/user/[username]',
      params: { username: 'dev-alex', tournamentName: 'officebabyfoot' },
    });
  });

  it('shows the live rivalry for the viewer', async () => {
    api.getGame.mockResolvedValue(game1);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    expect(await screen.findByTestId('game-detail-rivalry')).toBeTruthy();
    await waitFor(() =>
      expect(api.getRivalry).toHaveBeenCalledWith('dev-alex', 'guest-pat', 'officebabyfoot'),
    );
  });
});

describe('history rows', () => {
  it('open the durable game detail of the tapped row', async () => {
    const items = historyItems([game1, game2]);
    await renderWithClient(
      <View>
        {items.map((item) => (
          <View key={item.key}>{renderListItem(item, 'dev-alex')}</View>
        ))}
      </View>,
    );

    await fireEvent.press(screen.getByTestId('game-row-g2'));
    expect(mockedRouter.push).toHaveBeenLastCalledWith({
      pathname: '/games/[id]',
      params: { id: 'g2' },
    });
    await fireEvent.press(screen.getByTestId('game-row-g1'));
    expect(mockedRouter.push).toHaveBeenLastCalledWith({
      pathname: '/games/[id]',
      params: { id: 'g1' },
    });
    expect(screen.queryByTestId('game-rivalry')).toBeNull();
  });

  it('openGame pushes the game route', () => {
    openGame('abc');
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/games/[id]',
      params: { id: 'abc' },
    });
  });
});

describe('GameResultScreen', () => {
  it('reuses the cached submission and still fetches the durable game', async () => {
    client.setQueryData(gameKeys.detail('g1'), game1);
    api.getGame.mockResolvedValue(game1);
    await renderWithClient(<GameResultScreen id="g1" viewer="dev-alex" />);
    expect(screen.getByText('Office Babyfoot')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add another game'));
    expect(mockedRouter.navigate).toHaveBeenCalledWith('/add-game');
    await fireEvent.press(screen.getByTestId('result-back-to-feed'));
    expect(mockedRouter.navigate).toHaveBeenCalledWith('/feed');
  });

  it('loads the game by id after a reload with an empty cache', async () => {
    api.getGame.mockResolvedValue(game2);
    await renderWithClient(<GameResultScreen id="g2" />);
    expect(screen.getByTestId('game-detail-loading')).toBeTruthy();
    expect(await screen.findByText('Lunch Darts')).toBeTruthy();
    expect(api.getGame).toHaveBeenCalledWith('g2', expect.anything());
  });

  it('shows the not-found state when the id is missing', async () => {
    await renderWithClient(<GameResultScreen id={undefined} />);
    expect(screen.getByText(GAME_NOT_FOUND_TEXT)).toBeTruthy();
    expect(api.getGame).not.toHaveBeenCalled();
  });
});

describe('app stack layout', () => {
  it('anchors deep links on the tabs and names them so back buttons do not read "(tabs)"', async () => {
    const { Stack } = jest.requireMock<{ Stack: jest.Mock & { Screen: jest.Mock } }>('expo-router');
    await render(<AppLayout />);
    expect(unstable_settings).toEqual({ anchor: '(tabs)' });
    const tabs = Stack.Screen.mock.calls.find(([props]) => props.name === '(tabs)');
    expect(tabs?.[0].options).toEqual(expect.objectContaining({ title: 'Back' }));
  });
});
