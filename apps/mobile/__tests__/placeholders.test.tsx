import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, PlaceholderClaimLink, Stats, Tournament, User } from '@/api/types';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import { GameRow } from '@/components/game-row';
import { RankRow } from '@/components/rank-row';
import { UserTile } from '@/components/user-tile';
import { ProfileScreen } from '@/features/feed/profile-screen';
import {
  AddPlayers,
  placeholderAddedMessage,
  placeholderFailedMessage,
} from '@/features/game-form/add-players';
import { useGameFormStore } from '@/features/game-form/store';
import {
  clearIssuedLinks,
  setIssuedLinksStorage,
  useIssuedLinksStore,
} from '@/features/invites/issued-links';
import { inviteKeys } from '@/features/invites/queries';

import { memoryStorage } from '../test-utils/session';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);

const person = (username: string, accountType: User['accountType'] = 'REGISTERED'): User => ({
  id: `id-${username}`,
  username,
  accountType,
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

const issued = (username: string): PlaceholderClaimLink => ({
  user: person(username, 'PLACEHOLDER'),
  claimUrl: `http://localhost:8081/invite/claim/${username}-token`,
  claimExpiresAt: '2026-12-05T12:00:00.000Z',
});

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

const draftUsernames = () => useGameFormStore.getState().outcomes.map((o) => o.username);

beforeEach(async () => {
  jest.resetAllMocks();
  useAlertStore.setState({ current: null });
  setIssuedLinksStorage(memoryStorage().storage);
  await clearIssuedLinks();
  useGameFormStore.setState({
    owner: 'dev-alex',
    tournament,
    outcomes: [{ username: 'dev-alex', result: 'WIN' }],
  });
});

afterAll(() => setIssuedLinksStorage(null));

describe('AddPlayers: add player by name', () => {
  it('creates a placeholder and adds it to the draft on the chosen side', async () => {
    api.createPlaceholder.mockResolvedValue(issued('guest-river'));
    await renderWithClient(<AddPlayers ownerId="u-alex" />);

    await fireEvent.press(screen.getByLabelText('Add as loser'));
    await fireEvent.changeText(screen.getByLabelText('New player name'), '  River Guest ');
    await fireEvent.press(screen.getByTestId('placeholder-add'));

    await waitFor(() => expect(draftUsernames()).toEqual(['dev-alex', 'guest-river']));
    expect(api.createPlaceholder).toHaveBeenCalledWith({ displayName: 'River Guest' });
    expect(useGameFormStore.getState().outcomes[1]).toEqual({
      username: 'guest-river',
      result: 'LOSS',
    });
    expect(await screen.findByText(placeholderAddedMessage('guest-river', 'LOSS'))).toBeTruthy();
    expect(screen.getByLabelText('New player name').props.value).toBe('');
    // The one-time claim link is kept for the account that created it.
    expect(useIssuedLinksStore.getState().claims['id-guest-river']?.url).toBe(
      'http://localhost:8081/invite/claim/guest-river-token',
    );
  });

  it('shows the pending state while the placeholder is being created', async () => {
    let resolve!: (value: PlaceholderClaimLink) => void;
    api.createPlaceholder.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderWithClient(<AddPlayers ownerId="u-alex" />);

    await fireEvent.changeText(screen.getByLabelText('New player name'), 'Robin');
    await fireEvent.press(screen.getByTestId('placeholder-add'));
    expect(await screen.findByTestId('placeholder-pending')).toHaveTextContent('Adding Robin…');
    expect(draftUsernames()).toEqual(['dev-alex']);

    resolve(issued('guest-robin'));
    await waitFor(() => expect(screen.queryByTestId('placeholder-pending')).toBeNull());
    expect(draftUsernames()).toEqual(['dev-alex', 'guest-robin']);
  });

  it('keeps the draft and the typed name on failure, then retries successfully', async () => {
    useGameFormStore.setState({
      outcomes: [
        { username: 'dev-alex', result: 'WIN' },
        { username: 'dev-sam', result: 'LOSS' },
      ],
    });
    api.createPlaceholder.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_ERROR', 'displayName is too long.'),
    );
    await renderWithClient(<AddPlayers ownerId="u-alex" />);

    await fireEvent.changeText(screen.getByLabelText('New player name'), 'Robin');
    await fireEvent.press(screen.getByTestId('placeholder-add'));

    expect(await screen.findByTestId('placeholder-error')).toBeTruthy();
    expect(
      screen.getByText(placeholderFailedMessage('Robin', 'displayName is too long.')),
    ).toBeTruthy();
    expect(draftUsernames()).toEqual(['dev-alex', 'dev-sam']);
    expect(useGameFormStore.getState().tournament).toEqual(tournament);
    expect(screen.getByLabelText('New player name').props.value).toBe('Robin');

    api.createPlaceholder.mockResolvedValueOnce(issued('guest-robin'));
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(draftUsernames()).toEqual(['dev-alex', 'dev-sam', 'guest-robin']));
    expect(screen.queryByTestId('placeholder-error')).toBeNull();
    expect(api.createPlaceholder).toHaveBeenCalledTimes(2);
  });

  it('does not submit an empty name', async () => {
    await renderWithClient(<AddPlayers ownerId="u-alex" />);
    await fireEvent.changeText(screen.getByLabelText('New player name'), '   ');
    expect(screen.getByTestId('placeholder-add')).toBeDisabled();
    expect(api.createPlaceholder).not.toHaveBeenCalled();
  });

  it('refreshes the invited players list after creating a placeholder', async () => {
    api.createPlaceholder.mockResolvedValue(issued('guest-river'));
    await renderWithClient(<AddPlayers ownerId="u-alex" />);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await fireEvent.changeText(screen.getByLabelText('New player name'), 'River');
    await fireEvent.press(screen.getByTestId('placeholder-add'));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: inviteKeys.invitedPlayers('u-alex') }),
    );
  });
});

describe('AddPlayers: existing players', () => {
  it('finds registered and placeholder players, labels placeholders and skips draft members', async () => {
    api.listUsers.mockResolvedValue([
      person('dev-alex'),
      person('dev-sam'),
      person('guest-riley', 'PLACEHOLDER'),
    ]);
    await renderWithClient(<AddPlayers ownerId="u-alex" />);

    await fireEvent.changeText(screen.getByLabelText('Find a player'), 'e');
    expect(await screen.findByLabelText('Add guest-riley')).toBeTruthy();
    expect(screen.getByTestId('player-option-guest-riley-unclaimed')).toHaveTextContent(
      'UNCLAIMED',
    );
    expect(screen.queryByTestId('player-option-dev-sam-unclaimed')).toBeNull();
    expect(screen.queryByLabelText('Add dev-alex')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Add as loser'));
    await fireEvent.press(screen.getByLabelText('Add guest-riley'));
    expect(useGameFormStore.getState().outcomes).toEqual([
      { username: 'dev-alex', result: 'WIN' },
      { username: 'guest-riley', result: 'LOSS' },
    ]);
    expect(api.createPlaceholder).not.toHaveBeenCalled();
  });

  it('says when nothing matches', async () => {
    api.listUsers.mockResolvedValue([person('dev-sam')]);
    await renderWithClient(<AddPlayers ownerId="u-alex" />);
    await fireEvent.changeText(screen.getByLabelText('Find a player'), 'zzz');
    expect(await screen.findByText('No player matches “zzz”.')).toBeTruthy();
  });
});

describe('placeholder labels', () => {
  const game: Game = {
    id: 'g1',
    date: new Date(Date.now() - 60_000).toISOString(),
    tournament,
    outcomes: [
      { id: 'o1', result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: person('dev-alex') },
      {
        id: 'o2',
        result: 'LOSS',
        scoreValue: -16,
        ratingBefore: 1000,
        user: person('guest-riley', 'PLACEHOLDER'),
      },
    ],
  };

  it('marks only placeholder players in game history', async () => {
    await renderWithClient(<GameRow game={game} />);
    expect(screen.getByTestId('game-losers')).toHaveTextContent(/guest-riley · unclaimed/);
    expect(screen.getByTestId('game-winners')).not.toHaveTextContent(/unclaimed/);
  });

  it('marks placeholders on leaderboard rows', async () => {
    await render(<RankRow position={2} name="guest-riley" score={1016} unclaimed />);
    expect(screen.getByTestId('rank-row-guest-riley-unclaimed')).toHaveTextContent('UNCLAIMED');
    await render(<RankRow position={1} name="dev-alex" score={1030} />);
    expect(screen.queryByTestId('rank-row-dev-alex-unclaimed')).toBeNull();
  });

  it('never offers a challenge on an unclaimed user tile', async () => {
    await render(
      <UserTile username="guest-riley" wins={0} games={1} unclaimed onChallenge={jest.fn()} />,
    );
    expect(screen.getByTestId('user-tile-unclaimed')).toHaveTextContent('UNCLAIMED PLAYER');
    expect(screen.queryByLabelText('Challenge guest-riley')).toBeNull();
    expect(screen.queryByText('TAP TO CHALLENGE')).toBeNull();
  });

  it('labels a placeholder profile and hides the challenge action', async () => {
    const stats = {
      id: 'st1',
      user: person('guest-riley', 'PLACEHOLDER'),
      tournament,
      score: 984,
      bestScore: 1000,
      worstScore: 984,
      gameCount: 1,
      winCount: 0,
      loseCount: 1,
      tieCount: 0,
      winStreak: 0,
      loseStreak: 1,
      tieStreak: 0,
      longestWinStreak: 0,
      longestLoseStreak: 1,
      longestTieStreak: 0,
      bestRivalry: null,
      worstRivalry: null,
    } satisfies Stats;
    api.getUserStats.mockResolvedValue([stats]);
    api.getUserRivalries.mockResolvedValue([]);
    api.getUserGames.mockResolvedValue([game]);
    api.getUser.mockResolvedValue(person('guest-riley', 'PLACEHOLDER'));

    await renderWithClient(<ProfileScreen username="guest-riley" viewer="dev-alex" />);
    expect(await screen.findByTestId('user-tile-unclaimed')).toBeTruthy();
    expect(screen.queryByLabelText('Challenge guest-riley')).toBeNull();
    expect(screen.getByText(/guest-riley · unclaimed/)).toBeTruthy();
    expect(api.getUser).toHaveBeenCalledWith('guest-riley');
  });
});
