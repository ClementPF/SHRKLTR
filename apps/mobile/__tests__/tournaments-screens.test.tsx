import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, Stats, Tournament, User } from '@/api/types';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import {
  CreateTournamentScreen,
  SPORTS_LOAD_FAILED_TEXT,
  createdMessage,
} from '@/features/tournaments/create-tournament-screen';
import { NO_GAMES_TEXT, TournamentScreen } from '@/features/tournaments/tournament-screen';
import {
  NO_TOURNAMENTS_TEXT,
  TOURNAMENTS_LOAD_FAILED_TEXT,
  TournamentsScreen,
} from '@/features/tournaments/tournaments-screen';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);
const mockedRouter = jest.mocked(router);

const user = (username: string): User => ({
  id: `id-${username}`,
  username,
  accountType: 'REGISTERED',
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const tournament = (name: string, displayName: string, sport: string): Tournament => ({
  id: `t-${name}`,
  name,
  displayName,
  isOver: false,
  sport: { id: `s-${sport}`, name: sport },
  owner: null,
});

const babyfoot = tournament('officebabyfoot', 'Office Babyfoot', 'babyfoot');
const pingpong = tournament('fridaypingpong', 'Friday Ping Pong', 'ping-pong');

const stat = (username: string, score: number): Stats => ({
  id: `st-${username}`,
  user: user(username),
  tournament: babyfoot,
  score,
  bestScore: score,
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
});

const game = (id: string): Game => ({
  id,
  date: new Date(Date.now() - 3_600_000).toISOString(),
  tournament: babyfoot,
  outcomes: [
    { id: `${id}-w`, result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: user('dev-alex') },
    { id: `${id}-l`, result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: user('dev-sam') },
  ],
});

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
});

describe('TournamentsScreen', () => {
  it('lists tournaments with display name, @name and sport', async () => {
    api.listTournaments.mockResolvedValue([babyfoot, pingpong]);
    await renderWithClient(<TournamentsScreen />);
    expect(await screen.findByText('ALL TOURNAMENTS')).toBeTruthy();
    expect(screen.getByText('Office Babyfoot')).toBeTruthy();
    expect(screen.getByText('@officebabyfoot')).toBeTruthy();
    expect(screen.getByText('babyfoot')).toBeTruthy();
    expect(screen.getByText('Friday Ping Pong')).toBeTruthy();
  });

  it('filters the list client-side as the search term changes', async () => {
    api.listTournaments.mockResolvedValue([babyfoot, pingpong]);
    await renderWithClient(<TournamentsScreen />);
    await screen.findByText('Office Babyfoot');

    await fireEvent.changeText(screen.getByTestId('search-bar'), 'ping');
    expect(screen.queryByText('Office Babyfoot')).toBeNull();
    expect(screen.getByText('Friday Ping Pong')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('search-bar'), 'nothing-matches');
    expect(screen.getByText(NO_TOURNAMENTS_TEXT)).toBeTruthy();
    expect(api.listTournaments).toHaveBeenCalledTimes(1);
  });

  it('opens the tournament detail when a row is tapped', async () => {
    api.listTournaments.mockResolvedValue([babyfoot]);
    await renderWithClient(<TournamentsScreen />);
    await fireEvent.press(await screen.findByTestId('tournament-row-officebabyfoot'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/tournament/[name]',
      params: { name: 'officebabyfoot', displayName: 'Office Babyfoot' },
    });
  });

  it('offers to create a tournament when there are none', async () => {
    api.listTournaments.mockResolvedValue([]);
    await renderWithClient(<TournamentsScreen />);
    expect(await screen.findByText(NO_TOURNAMENTS_TEXT)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Create a tournament'));
    expect(mockedRouter.push).toHaveBeenCalledWith('/new-tournament');
  });

  it('shows an error alert and a retry state when the API is down', async () => {
    api.listTournaments.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Network request failed'),
    );
    await renderWithClient(<TournamentsScreen />);
    expect(await screen.findByText(TOURNAMENTS_LOAD_FAILED_TEXT)).toBeTruthy();
    expect(screen.getByTestId('dropdown-alert')).toHaveTextContent(
      'ErrorFailed to load tournaments: Network request failed',
    );
  });
});

describe('TournamentScreen', () => {
  it('renders the RANKING with client-computed positions and the paginated HISTORY', async () => {
    api.getTournamentStats.mockResolvedValue([stat('dev-sam', 984), stat('dev-alex', 1016.4)]);
    api.getTournamentGames.mockResolvedValue([game('g1')]);
    await renderWithClient(<TournamentScreen name="officebabyfoot" viewer="dev-alex" />);

    expect(await screen.findByText('RANKING')).toBeTruthy();
    expect(screen.getByText('HISTORY')).toBeTruthy();
    expect(screen.getByTestId('rank-row-dev-alex')).toHaveTextContent('1dev-alex1016');
    expect(screen.getByTestId('rank-row-dev-sam')).toHaveTextContent('2dev-sam984');
    expect(screen.getByTestId('game-row-g1')).toBeTruthy();
    expect(api.getTournamentGames).toHaveBeenCalledWith('officebabyfoot', {
      page: 0,
      pageSize: 10,
    });
  });

  it('opens the user detail for that tournament when a ranked player is tapped', async () => {
    api.getTournamentStats.mockResolvedValue([stat('dev-sam', 1000)]);
    api.getTournamentGames.mockResolvedValue([]);
    await renderWithClient(<TournamentScreen name="officebabyfoot" />);
    await fireEvent.press(await screen.findByTestId('rank-row-dev-sam'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/user/[username]',
      params: { username: 'dev-sam', tournamentName: 'officebabyfoot' },
    });
  });

  it('shows the empty state when no game was played yet', async () => {
    api.getTournamentStats.mockResolvedValue([]);
    api.getTournamentGames.mockResolvedValue([]);
    await renderWithClient(<TournamentScreen name="officebabyfoot" />);
    expect(await screen.findByText(NO_GAMES_TEXT)).toBeTruthy();
  });

  it('alerts when the ranking fails to load', async () => {
    api.getTournamentStats.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    api.getTournamentGames.mockResolvedValue([game('g1')]);
    await renderWithClient(<TournamentScreen name="officebabyfoot" />);
    expect(await screen.findByTestId('dropdown-alert')).toHaveTextContent(
      'ErrorFailed to load the ranking: boom',
    );
    expect(screen.getByTestId('game-row-g1')).toBeTruthy();
  });
});

describe('CreateTournamentScreen', () => {
  it('posts the title and sport, shows the success alert and reports the new tournament', async () => {
    api.listSports.mockResolvedValue([{ id: 's1', name: 'babyfoot' }]);
    api.createTournament.mockResolvedValue(babyfoot);
    const onCreated = jest.fn();
    await renderWithClient(<CreateTournamentScreen onCreated={onCreated} />);

    expect(screen.getByLabelText('Create tournament')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('tournament-title-input'), ' Office Babyfoot ');
    await fireEvent.press(await screen.findByLabelText('Sport babyfoot'));
    await fireEvent.press(screen.getByLabelText('Create tournament'));

    expect(await screen.findByText(createdMessage('Office Babyfoot'))).toBeTruthy();
    expect(api.createTournament).toHaveBeenCalledWith({
      displayName: 'Office Babyfoot',
      sportName: 'babyfoot',
    });
    expect(onCreated).toHaveBeenCalledWith(babyfoot);
    // Creation invalidates the sports query; let that refetch settle inside the test.
    await waitFor(() => expect(api.listSports).toHaveBeenCalledTimes(2));
    await screen.findByLabelText('Sport babyfoot');
  });

  it('alerts with the API message when creation fails', async () => {
    api.listSports.mockResolvedValue([{ id: 's1', name: 'babyfoot' }]);
    api.createTournament.mockRejectedValue(
      new ApiError(400, 'DUPLICATE', 'Tournament officebabyfoot already exists'),
    );
    const onCreated = jest.fn();
    await renderWithClient(<CreateTournamentScreen onCreated={onCreated} />);
    await screen.findByLabelText('Sport babyfoot');
    await fireEvent.changeText(screen.getByTestId('tournament-title-input'), 'Office Babyfoot');
    await fireEvent.changeText(screen.getByTestId('tournament-sport-input'), 'babyfoot');
    await fireEvent.press(screen.getByLabelText('Create tournament'));

    expect(
      await screen.findByText(
        'Failed to create tournament: Tournament officebabyfoot already exists',
      ),
    ).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('surfaces a sports failure with an alert and a retry while manual entry and creation keep working', async () => {
    api.listSports.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Network request failed'));
    api.createTournament.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const onCreated = jest.fn();
    await renderWithClient(<CreateTournamentScreen onCreated={onCreated} />);

    expect(await screen.findByText(SPORTS_LOAD_FAILED_TEXT)).toBeTruthy();
    expect(screen.getByTestId('dropdown-alert')).toHaveTextContent(
      'ErrorFailed to load sports: Network request failed',
    );

    await fireEvent.changeText(screen.getByTestId('tournament-title-input'), 'Office Babyfoot');
    await fireEvent.changeText(screen.getByTestId('tournament-sport-input'), 'babyfoot');
    expect(screen.getByLabelText('Create tournament')).toBeEnabled();
    await fireEvent.press(screen.getByLabelText('Create tournament'));
    expect(await screen.findByText('Failed to create tournament: boom')).toBeTruthy();
    expect(api.createTournament).toHaveBeenCalledWith({
      displayName: 'Office Babyfoot',
      sportName: 'babyfoot',
    });

    api.listSports.mockResolvedValue([{ id: 's1', name: 'babyfoot' }]);
    await fireEvent.press(screen.getByLabelText('Retry loading sports'));
    expect(await screen.findByLabelText('Sport babyfoot')).toBeTruthy();
    expect(screen.queryByText(SPORTS_LOAD_FAILED_TEXT)).toBeNull();
  });
});
