import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Challenge, GroupMember, Tournament, User } from '@/api/types';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import { ChallengeDetailScreen } from '@/features/challenges/challenge-detail-screen';
import { CHALLENGE_NOT_FOUND_TEXT } from '@/features/challenges/challenge-parts';
import {
  ChallengesScreen,
  NO_ACTIVE_CHALLENGES_TEXT,
  NO_PAST_CHALLENGES_TEXT,
} from '@/features/challenges/challenges-screen';
import { ChallengeComposer, NOT_REGISTERED_TEXT } from '@/features/challenges/composer-screen';
import {
  DAY_MS,
  DEADLINE_MALFORMED_TEXT,
  DEADLINE_TOO_LATE_TEXT,
  DEADLINE_TOO_SOON_TEXT,
  HOUR_MS,
  deadlineAtFor,
  deadlineProblem,
  parseDuration,
} from '@/features/challenges/deadline';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);
const mockedRouter = jest.mocked(router);

const person = (username: string, accountType: User['accountType'] = 'REGISTERED'): User => ({
  id: `id-${username}`,
  username,
  accountType,
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const alex = person('dev-alex');
const sam = person('dev-sam');
const jordan = person('dev-jordan');
const riley = person('guest-riley', 'PLACEHOLDER');

const GROUP = { id: '5ea0c0de-0000-4000-8000-000000000001', name: 'Shark Tank' };
const OTHER_GROUP = { id: '5ea0c0de-0000-4000-8000-000000000002', name: 'Chess Nerds' };

const tournament = (name: string, extra: Partial<Tournament> = {}): Tournament => ({
  id: `t-${name}`,
  name,
  displayName: name.replace(/^./, (c) => c.toUpperCase()),
  isOver: false,
  sport: { id: 's1', name: 'darts' },
  owner: null,
  group: null,
  ...extra,
});

const babyfoot = tournament('officebabyfoot', { displayName: 'Office Babyfoot' });
const finished = tournament('oldleague', { displayName: 'Old League', isOver: true });
const tankCup = tournament('sharktankcup', { displayName: 'Shark Tank Cup', group: GROUP });
const chessCup = tournament('chesscup', { displayName: 'Chess Cup', group: OTHER_GROUP });

const member = (user: User): GroupMember => ({
  user,
  role: 'MEMBER',
  joinedAt: '2026-11-01T00:00:00.000Z',
});

const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

const challenge = (overrides: Partial<Challenge> = {}): Challenge => ({
  id: '5ea0c0de-0000-4000-8000-000000000101',
  tournament: babyfoot,
  challenger: alex,
  opponent: sam,
  status: 'PENDING',
  deadlineAt: inDays(7),
  createdAt: inDays(-1),
  acceptedAt: null,
  resolvedAt: null,
  winner: null,
  gameId: null,
  ...overrides,
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

beforeEach(() => {
  jest.resetAllMocks();
  useAlertStore.setState({ current: null });
});

afterEach(() => client?.clear());

describe('deadline rules', () => {
  it('accepts 1 hour to 30 days inclusive and explains everything else', () => {
    expect(deadlineProblem(parseDuration('1', 'hours'))).toBeNull();
    expect(deadlineProblem(parseDuration('30', 'days'))).toBeNull();
    expect(deadlineProblem(parseDuration('720', 'hours'))).toBeNull();
    expect(deadlineProblem(parseDuration('0', 'hours'))).toBe(DEADLINE_TOO_SOON_TEXT);
    expect(deadlineProblem(HOUR_MS - 1)).toBe(DEADLINE_TOO_SOON_TEXT);
    expect(deadlineProblem(parseDuration('31', 'days'))).toBe(DEADLINE_TOO_LATE_TEXT);
    expect(deadlineProblem(parseDuration('721', 'hours'))).toBe(DEADLINE_TOO_LATE_TEXT);
    for (const malformed of ['', 'abc', '1.5', '-2', '3d']) {
      expect(deadlineProblem(parseDuration(malformed, 'days'))).toBe(DEADLINE_MALFORMED_TEXT);
    }
  });

  it('leaves the default 7 days to the server and keeps sent deadlines inside the range', () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    expect(deadlineAtFor(7 * DAY_MS, now)).toBeUndefined();
    expect(deadlineAtFor(3 * DAY_MS, now)).toBe('2026-11-08T12:00:00.000Z');
    const min = new Date(deadlineAtFor(HOUR_MS, now)!).getTime() - now.getTime();
    const max = new Date(deadlineAtFor(30 * DAY_MS, now)!).getTime() - now.getTime();
    expect(min).toBeGreaterThan(HOUR_MS);
    expect(min).toBeLessThanOrEqual(HOUR_MS + 60_000);
    expect(max).toBeLessThan(30 * DAY_MS);
    expect(max).toBeGreaterThanOrEqual(30 * DAY_MS - 60_000);
  });
});

describe('ChallengeComposer', () => {
  const onCreated = jest.fn();

  beforeEach(() => {
    api.getUser.mockImplementation(async (username: string) =>
      [alex, sam, jordan, riley].find((u) => u.username === username)!,
    );
    api.listTournaments.mockResolvedValue([babyfoot, finished, tankCup, chessCup]);
    api.listGroupMembers.mockImplementation(async (groupId: string) =>
      groupId === GROUP.id ? [member(alex), member(sam)] : [member(alex), member(jordan)],
    );
    api.listUsers.mockResolvedValue([alex, sam, jordan, riley]);
  });

  function renderComposer(props: { opponent?: string; tournament?: string } = {}) {
    return renderWithClient(
      <ChallengeComposer
        viewer="dev-alex"
        initialOpponent={props.opponent}
        initialTournament={props.tournament}
        onCreated={onCreated}
      />,
    );
  }

  it('prefills the opponent and offers only running tournaments you both can play in', async () => {
    await renderComposer({ opponent: 'dev-sam' });
    expect(within(screen.getByTestId('selected-opponent')).getByText('@dev-sam')).toBeTruthy();
    expect(await screen.findByTestId('tournament-option-officebabyfoot')).toBeTruthy();
    expect(screen.getByTestId('tournament-option-sharktankcup')).toBeTruthy();
    // Sam is not in the chess group, and finished tournaments cannot host a challenge.
    expect(screen.queryByTestId('tournament-option-chesscup')).toBeNull();
    expect(screen.queryByTestId('tournament-option-oldleague')).toBeNull();
    // Defaults to seven days; opening the composer creates nothing.
    expect(screen.getByTestId('deadline-7d')).toBeChecked();
    expect(api.createChallenge).not.toHaveBeenCalled();
  });

  it('creates the challenge with the server default deadline and hands it over', async () => {
    const created = challenge({ tournament: tankCup });
    api.createChallenge.mockResolvedValue(created);
    await renderComposer({ opponent: 'dev-sam' });
    await fireEvent.press(await screen.findByTestId('tournament-option-sharktankcup'));
    await fireEvent.press(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(api.createChallenge).toHaveBeenCalledWith({
      tournamentName: 'sharktankcup',
      opponentUsername: 'dev-sam',
      deadlineAt: undefined,
    });
  });

  it('asks for a tournament before sending', async () => {
    await renderComposer({ opponent: 'dev-sam' });
    await screen.findByTestId('tournament-option-officebabyfoot');
    await fireEvent.press(screen.getByRole('button', { name: 'Send challenge' }));
    expect(screen.getByTestId('tournament-error')).toHaveTextContent('Choose a tournament.');
    expect(api.createChallenge).not.toHaveBeenCalled();
  });

  it('explains out-of-range custom deadlines and stays usable afterwards', async () => {
    api.createChallenge.mockResolvedValue(challenge());
    await renderComposer({ opponent: 'dev-sam', tournament: 'officebabyfoot' });
    await screen.findByTestId('tournament-option-officebabyfoot');
    await fireEvent.press(screen.getByTestId('deadline-custom'));

    await fireEvent.changeText(screen.getByTestId('deadline-amount-input'), '45');
    expect(screen.getByTestId('deadline-error')).toHaveTextContent(DEADLINE_TOO_LATE_TEXT);
    await fireEvent.press(screen.getByRole('button', { name: 'Send challenge' }));
    expect(api.createChallenge).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('deadline-unit-hours'));
    await fireEvent.changeText(screen.getByTestId('deadline-amount-input'), '0');
    expect(screen.getByTestId('deadline-error')).toHaveTextContent(DEADLINE_TOO_SOON_TEXT);

    await fireEvent.changeText(screen.getByTestId('deadline-amount-input'), 'soon');
    expect(screen.getByTestId('deadline-error')).toHaveTextContent(DEADLINE_MALFORMED_TEXT);

    await fireEvent.changeText(screen.getByTestId('deadline-amount-input'), '2');
    expect(screen.queryByTestId('deadline-error')).toBeNull();
    const before = Date.now();
    await fireEvent.press(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(api.createChallenge).toHaveBeenCalledTimes(1));
    const sent = api.createChallenge.mock.calls[0]![0];
    expect(sent.tournamentName).toBe('officebabyfoot');
    const ahead = new Date(sent.deadlineAt!).getTime() - before;
    expect(ahead).toBeGreaterThanOrEqual(2 * HOUR_MS - 1000);
    expect(ahead).toBeLessThanOrEqual(2 * HOUR_MS + 1000);
  });

  it('shows why the server refused and lets the player try again', async () => {
    api.createChallenge
      .mockRejectedValueOnce(
        new ApiError(400, 'ACTIVE_CHALLENGE_EXISTS', 'An active challenge already exists'),
      )
      .mockResolvedValueOnce(challenge());
    await renderComposer({ opponent: 'dev-sam', tournament: 'officebabyfoot' });
    await screen.findByTestId('tournament-option-officebabyfoot');
    await fireEvent.press(screen.getByRole('button', { name: 'Send challenge' }));
    expect(await screen.findByTestId('create-challenge-error')).toHaveTextContent(
      /already have an active challenge/,
    );
    expect(onCreated).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('tournament-option-sharktankcup'));
    expect(screen.queryByTestId('create-challenge-error')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('refuses a placeholder opponent', async () => {
    await renderComposer({ opponent: 'guest-riley' });
    expect(await screen.findByTestId('opponent-error')).toHaveTextContent(NOT_REGISTERED_TEXT);
    expect(screen.getByRole('button', { name: 'Send challenge' })).toBeDisabled();
  });

  it('searches registered players other than yourself when no opponent is given', async () => {
    await renderComposer();
    expect(screen.getByText(/Choose an opponent to see the tournaments/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Find an opponent'), 'e');
    expect(await screen.findByTestId('opponent-option-dev-sam')).toBeTruthy();
    expect(screen.getByTestId('opponent-option-dev-jordan')).toBeTruthy();
    expect(screen.queryByTestId('opponent-option-dev-alex')).toBeNull();
    expect(screen.queryByTestId('opponent-option-guest-riley')).toBeNull();

    await fireEvent.press(screen.getByTestId('opponent-option-dev-jordan'));
    expect(await screen.findByTestId('tournament-option-chesscup')).toBeTruthy();
    expect(screen.queryByTestId('tournament-option-sharktankcup')).toBeNull();
  });
});

describe('ChallengesScreen', () => {
  it('shows an empty state when there is nothing active or past', async () => {
    api.listChallenges.mockResolvedValue([]);
    await renderWithClient(<ChallengesScreen viewerId={alex.id} />);
    expect(await screen.findByText(NO_ACTIVE_CHALLENGES_TEXT)).toBeTruthy();
    expect(api.listChallenges).toHaveBeenCalledWith(
      { page: 0, pageSize: 20, status: ['PENDING', 'ACCEPTED'] },
      expect.anything(),
    );
    await fireEvent.press(screen.getByRole('tab', { name: 'Past challenges' }));
    expect(await screen.findByText(NO_PAST_CHALLENGES_TEXT)).toBeTruthy();
    expect(api.listChallenges).toHaveBeenLastCalledWith(
      { page: 0, pageSize: 20, status: ['DECLINED', 'COMPLETED', 'EXPIRED'] },
      expect.anything(),
    );
  });

  it('groups active challenges by what you have to do and opens their detail', async () => {
    const incoming = challenge({ id: 'c-in', challenger: jordan, opponent: alex });
    const sent = challenge({ id: 'c-out' });
    const accepted = challenge({ id: 'c-acc', status: 'ACCEPTED', acceptedAt: inDays(-1) });
    api.listChallenges.mockResolvedValue([sent, accepted, incoming]);
    await renderWithClient(<ChallengesScreen viewerId={alex.id} />);

    expect(await screen.findByText('WAITING FOR YOU')).toBeTruthy();
    expect(screen.getByText('SENT')).toBeTruthy();
    // Section header plus the accepted row's status badge.
    expect(screen.getAllByText('ACCEPTED')).toHaveLength(2);
    expect(screen.getByTestId('challenge-row-c-in')).toHaveTextContent(/dev-jordan vs you/);
    expect(screen.getByTestId('challenge-row-c-in')).toHaveTextContent(/Waiting for your answer/);
    expect(screen.getByTestId('challenge-row-c-out')).toHaveTextContent(/You vs dev-sam/);
    expect(screen.getByTestId('challenge-row-c-out')).toHaveTextContent(/Office Babyfoot/);
    expect(screen.getByTestId('challenge-row-c-acc-status')).toHaveTextContent('ACCEPTED');

    await fireEvent.press(screen.getByTestId('challenge-row-c-in'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/challenges/[id]',
      params: { id: 'c-in' },
    });
  });

  it('lists past challenges with their result', async () => {
    api.listChallenges.mockImplementation(async ({ status } = {}) =>
      status?.includes('PENDING')
        ? []
        : [
            challenge({ id: 'c-won', status: 'COMPLETED', winner: alex, gameId: 'g1' }),
            challenge({ id: 'c-dec', status: 'DECLINED', resolvedAt: inDays(-1) }),
            challenge({ id: 'c-exp', status: 'EXPIRED', resolvedAt: inDays(-1) }),
          ],
    );
    await renderWithClient(<ChallengesScreen viewerId={alex.id} />);
    await screen.findByText(NO_ACTIVE_CHALLENGES_TEXT);
    await fireEvent.press(screen.getByRole('tab', { name: 'Past challenges' }));
    expect(await screen.findByTestId('challenge-row-c-won')).toHaveTextContent(/You won/);
    expect(screen.getByTestId('challenge-row-c-dec')).toHaveTextContent(/dev-sam declined/);
    expect(screen.getByTestId('challenge-row-c-exp')).toHaveTextContent(/Expired/);
    expect(screen.queryByText(NO_ACTIVE_CHALLENGES_TEXT)).toBeNull();
  });
});

describe('ChallengeDetailScreen', () => {
  const ID = '5ea0c0de-0000-4000-8000-000000000101';
  const renderDetail = (viewer: User) =>
    renderWithClient(<ChallengeDetailScreen id={ID} viewerId={viewer.id} />);

  it('lets the opponent accept a pending challenge, then removes the actions', async () => {
    api.getChallenge.mockResolvedValueOnce(challenge());
    const accepted = challenge({ status: 'ACCEPTED', acceptedAt: new Date().toISOString() });
    api.respondToChallenge.mockResolvedValue(accepted);
    api.getChallenge.mockResolvedValue(accepted);
    await renderDetail(sam);

    expect(await screen.findByTestId('challenge-state-text')).toHaveTextContent(
      /dev-alex challenged you in Office Babyfoot/,
    );
    expect(screen.getByTestId('challenge-tournament')).toHaveTextContent('Office Babyfoot');
    await fireEvent.press(screen.getByRole('button', { name: 'Accept challenge' }));
    expect(api.respondToChallenge).toHaveBeenCalledWith(ID, 'ACCEPT');
    await waitFor(() =>
      expect(screen.getByTestId('challenge-status')).toHaveTextContent('ACCEPTED'),
    );
    expect(screen.queryByRole('button', { name: 'Accept challenge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline challenge' })).toBeNull();
    expect(screen.getByTestId('challenge-state-text')).toHaveTextContent(
      /Your next game against dev-alex/,
    );
  });

  it('declines after confirmation', async () => {
    const declined = challenge({ status: 'DECLINED', resolvedAt: new Date().toISOString() });
    api.getChallenge.mockResolvedValueOnce(challenge());
    api.getChallenge.mockResolvedValue(declined);
    api.respondToChallenge.mockResolvedValue(declined);
    await renderDetail(sam);
    await fireEvent.press(await screen.findByRole('button', { name: 'Decline challenge' }));
    expect(api.respondToChallenge).not.toHaveBeenCalled();
    await fireEvent.press(within(screen.getByTestId('confirm-dialog')).getByText('Decline'));
    expect(api.respondToChallenge).toHaveBeenCalledWith(ID, 'DECLINE');
    expect(await screen.findByText('You declined this challenge.')).toBeTruthy();
  });

  it('reports a refused answer and refreshes the challenge', async () => {
    api.getChallenge.mockResolvedValueOnce(challenge());
    api.getChallenge.mockResolvedValue(challenge({ status: 'EXPIRED', resolvedAt: inDays(0) }));
    api.respondToChallenge.mockRejectedValue(
      new ApiError(400, 'CHALLENGE_EXPIRED', 'This challenge has expired'),
    );
    await renderDetail(sam);
    await fireEvent.press(await screen.findByRole('button', { name: 'Accept challenge' }));
    expect(await screen.findByText('This challenge has expired.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('challenge-status')).toHaveTextContent('EXPIRED'),
    );
    expect(screen.queryByRole('button', { name: 'Accept challenge' })).toBeNull();
  });

  it('shows the challenger a waiting state without answer controls', async () => {
    api.getChallenge.mockResolvedValue(challenge());
    await renderDetail(alex);
    expect(await screen.findByText('Waiting for dev-sam to accept or decline.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept challenge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline challenge' })).toBeNull();
  });

  it('offers no answer once the deadline passed', async () => {
    api.getChallenge.mockResolvedValue(challenge({ deadlineAt: inDays(-0.01) }));
    await renderDetail(sam);
    expect(await screen.findByTestId('challenge-state-text')).toHaveTextContent(/expiring/);
    expect(screen.queryByRole('button', { name: 'Accept challenge' })).toBeNull();
  });

  it('shows the winner and links to the deciding game', async () => {
    api.getChallenge.mockResolvedValue(
      challenge({
        status: 'COMPLETED',
        acceptedAt: inDays(-1),
        resolvedAt: inDays(0),
        winner: sam,
        gameId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    await renderDetail(alex);
    expect(await screen.findByTestId('challenge-winner')).toHaveTextContent('dev-sam');
    expect(screen.getByText('dev-sam won this challenge.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'View game' }));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/games/[id]',
      params: { id: '11111111-1111-4111-8111-111111111111' },
    });
  });

  it.each([
    ['DECLINED', alex, 'dev-sam declined this challenge.'],
    ['EXPIRED', sam, 'This challenge expired without a game. Nobody lost any points.'],
  ] as const)('renders a %s challenge without actions', async (status, viewer, text) => {
    api.getChallenge.mockResolvedValue(challenge({ status, resolvedAt: inDays(0) }));
    await renderDetail(viewer);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByTestId('challenge-status')).toHaveTextContent(status);
    expect(screen.queryByRole('button', { name: 'Accept challenge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View game' })).toBeNull();
  });

  it('shows not-found for a challenge you cannot see', async () => {
    api.getChallenge.mockRejectedValue(
      new ApiError(404, 'CHALLENGE_NOT_FOUND', 'Challenge not found'),
    );
    await renderDetail(jordan);
    expect(await screen.findByText(CHALLENGE_NOT_FOUND_TEXT)).toBeTruthy();
  });
});
