import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { router, usePathname } from 'expo-router';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type {
  Group,
  GroupInvite,
  GroupMember,
  GroupPlayer,
  GroupRole,
  Stats,
  Tournament,
  User,
} from '@/api/types';
import SettingsScreen from '@/app/(app)/(tabs)/settings';
import { PENDING_JOIN_KEY, readPendingJoin, savePendingJoin } from '@/auth/pending-join';
import { useSession, type SessionContextValue } from '@/auth/session';
import { TournamentRow } from '@/components/tournament-row';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import { LoginScreen } from '@/features/auth/login-screen';
import { AddPlayers } from '@/features/game-form/add-players';
import { useGameFormStore } from '@/features/game-form/store';
import { CreateGroupScreen, GROUP_NAME_TOO_LONG_TEXT } from '@/features/groups/create-group-screen';
import { GROUP_NOT_FOUND_TEXT } from '@/features/groups/group-parts';
import { GroupScreen, NO_UNCLAIMED_TEXT } from '@/features/groups/group-screen';
import { GroupsScreen, NO_GROUPS_TEXT } from '@/features/groups/groups-screen';
import { GroupInviteScreen, INVITE_MANAGERS_ONLY_TEXT } from '@/features/groups/invite-screen';
import {
  JOIN_CODE_INVALID_TEXT,
  JOIN_LINK_INVALID_TITLE,
  JoinCodeScreen,
  JoinLinkScreen,
} from '@/features/groups/join-screens';
import { GroupMembersScreen, OWNER_MUST_TRANSFER_TEXT } from '@/features/groups/members-screen';
import { usePendingJoinResume } from '@/features/groups/pending-join';
import { groupKeys } from '@/features/groups/queries';
import { CreateTournamentScreen } from '@/features/tournaments/create-tournament-screen';
import { tournamentKeys } from '@/features/tournaments/queries';

import { makeSession } from '../test-utils/session';

const mockSecureStore = new Map<string, string>();
// Plain functions, so resetAllMocks keeps the store working.
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureStore.delete(key);
  },
}));
jest.mock('@/api/endpoints');
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));
jest.mock('@/auth/google', () => ({
  useGoogleSignIn: () => ({
    ready: true,
    configured: true,
    status: 'idle',
    error: null,
    signIn: jest.fn(),
  }),
  googleRedirectUri: jest.fn(),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn(),
      back: jest.fn(),
      canGoBack: jest.fn(() => false),
    },
    usePathname: jest.fn(() => '/feed'),
    Link: (props: { href: string; testID?: string; children: string }) => (
      <Text {...props} accessibilityRole="link" />
    ),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ value }: { value: string }) => <Text testID="qr-svg">{value}</Text>,
  };
});

const api = jest.mocked(endpoints);
const mockedSession = jest.mocked(useSession);
const mockedRouter = jest.mocked(router);
const mockedPathname = jest.mocked(usePathname);

const GROUP_ID = '5ea0c0de-0000-4000-8000-000000000001';

const person = (username: string, accountType: User['accountType'] = 'REGISTERED'): User => ({
  id: `id-${username}`,
  username,
  accountType,
  firstName: username.replace(/^(dev|guest)-/, '').replace(/^./, (c) => c.toUpperCase()),
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const alex = { ...person('dev-alex'), id: makeSession().user.id };
const sam = person('dev-sam');
const jordan = person('dev-jordan');
const robin = person('guest-robin', 'PLACEHOLDER');

const group = (role: GroupRole, overrides: Partial<Group> = {}): Group => ({
  id: GROUP_ID,
  name: 'Shark Tank',
  role,
  memberCount: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

const member = (user: User, role: GroupRole): GroupMember => ({
  user,
  role,
  joinedAt: '2026-11-01T00:00:00.000Z',
});

const members = [member(alex, 'OWNER'), member(sam, 'ADMIN'), member(jordan, 'MEMBER')];
const roster: GroupPlayer[] = [{ user: robin, addedBy: alex, addedAt: '2026-11-01T00:00:00.000Z' }];

const tournament = (name: string, displayName: string): Tournament => ({
  id: `t-${name}`,
  name,
  displayName,
  isOver: false,
  sport: { id: 's-darts', name: 'darts' },
  owner: null,
  group: { id: GROUP_ID, name: 'Shark Tank' },
});

const cup = tournament('sharktankcup', 'Shark Tank Cup');
const league = tournament('sharktankleague', 'Shark Tank League');

const stat = (user: User, t: Tournament, score: number): Stats => ({
  id: `st-${user.username}-${t.name}`,
  user,
  tournament: t,
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

const notFound = () => new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');

function signedIn(user: User = alex) {
  const session = makeSession({ user });
  mockedSession.mockReturnValue({
    status: 'authenticated',
    session,
    user,
    loginWithGoogleCode: jest.fn(),
    loginWithDevUser: jest.fn(),
    logout: jest.fn(async () => undefined),
    refresh: jest.fn(),
  } as SessionContextValue);
}

function signedOut() {
  mockedSession.mockReturnValue({
    status: 'unauthenticated',
    session: null,
    user: null,
    loginWithGoogleCode: jest.fn(),
    loginWithDevUser: jest.fn(),
    logout: jest.fn(async () => undefined),
    refresh: jest.fn(),
  } as SessionContextValue);
}

let client: QueryClient;
function renderWithClient(ui: ReactElement, seed?: (c: QueryClient) => void) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  seed?.(client);
  return render(
    <QueryClientProvider client={client}>
      {ui}
      <DropdownAlert />
    </QueryClientProvider>,
  );
}

function mockGroup(role: GroupRole) {
  api.getGroup.mockResolvedValue(group(role));
  api.listGroupMembers.mockResolvedValue(members);
  api.listGroupTournaments.mockResolvedValue([cup, league]);
  api.listGroupPlayers.mockResolvedValue(roster);
  api.getTournamentStats.mockImplementation(async (name: string) =>
    name === cup.name
      ? [stat(sam, cup, 1016), stat(alex, cup, 984)]
      : [stat(jordan, league, 1032), stat(robin, league, 968)],
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSecureStore.clear();
  useAlertStore.setState({ current: null });
  mockedPathname.mockReturnValue('/feed');
  mockedRouter.canGoBack.mockReturnValue(false);
  signedIn();
});

afterEach(() => client?.clear());

describe('entry points', () => {
  it('opens My groups from Settings', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Groups' }));
    expect(mockedRouter.push).toHaveBeenCalledWith('/groups');
  });

  it('labels grouped tournaments in the tournament list', async () => {
    await render(<TournamentRow tournament={cup} onPress={jest.fn()} />);
    expect(screen.getByTestId('tournament-row-sharktankcup-group')).toHaveTextContent(
      'GROUP · Shark Tank',
    );
    await render(<TournamentRow tournament={{ ...cup, group: null }} onPress={jest.fn()} />);
    expect(screen.queryByTestId('tournament-row-sharktankcup-group')).toBeNull();
  });
});

describe('My groups', () => {
  it('explains how to start when the user has no group', async () => {
    api.listGroups.mockResolvedValue([]);
    await renderWithClient(<GroupsScreen />);
    expect(await screen.findByText(NO_GROUPS_TEXT)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create a group' }));
    expect(mockedRouter.push).toHaveBeenCalledWith('/groups/new');
    await fireEvent.press(screen.getByRole('button', { name: 'Join with a code' }));
    expect(mockedRouter.push).toHaveBeenCalledWith('/join');
  });

  it('lists memberships with role and member count and opens a group', async () => {
    api.listGroups.mockResolvedValue([
      group('OWNER'),
      group('MEMBER', { id: 'g2', name: 'Bar League', memberCount: 1 }),
    ]);
    await renderWithClient(<GroupsScreen />);
    expect(await screen.findByText('Shark Tank')).toBeTruthy();
    expect(screen.getByText('3 members')).toBeTruthy();
    expect(screen.getByText('1 member')).toBeTruthy();
    expect(screen.getByLabelText('Role Owner')).toBeTruthy();
    expect(screen.getByLabelText('Role Member')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open group Bar League'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/groups/[id]',
      params: { id: 'g2' },
    });
  });
});

describe('Create a group', () => {
  it('validates the name and creates the group with the trimmed name', async () => {
    const onCreated = jest.fn();
    api.createGroup.mockResolvedValue(group('OWNER', { name: 'Office Pong', memberCount: 1 }));
    await renderWithClient(<CreateGroupScreen onCreated={onCreated} />);

    expect(screen.getByRole('button', { name: 'Create group' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Group name'), 'x'.repeat(101));
    expect(screen.getByText(GROUP_NAME_TOO_LONG_TEXT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create group' })).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Group name'), '  Office Pong  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(api.createGroup).toHaveBeenCalledWith('Office Pong');
  });
});

describe('Group page', () => {
  it('shows members with roles, the unclaimed roster and per-tournament leaderboards', async () => {
    mockGroup('OWNER');
    await renderWithClient(<GroupScreen id={GROUP_ID} />);

    expect(await screen.findByTestId('group-name')).toHaveTextContent('Shark Tank');
    expect(screen.getByTestId('group-member-dev-alex-role')).toHaveTextContent('OWNER');
    expect(screen.getByTestId('group-member-dev-sam-role')).toHaveTextContent('ADMIN');
    expect(screen.getByTestId('group-member-dev-jordan-role')).toHaveTextContent('MEMBER');
    expect(screen.getByTestId('group-player-guest-robin-unclaimed')).toBeTruthy();
    expect(screen.queryByTestId('group-member-guest-robin')).toBeNull();

    const board = await screen.findByTestId('group-leaderboard-sharktankcup');
    expect(within(board).getByText('dev-sam')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Leaderboard of Shark Tank League'));
    const other = await screen.findByTestId('group-leaderboard-sharktankleague');
    expect(within(other).getByText('dev-jordan')).toBeTruthy();
    expect(screen.queryByTestId('group-leaderboard-sharktankcup')).toBeNull();

    expect(screen.getByRole('button', { name: 'Invite people' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'New tournament in this group' }));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/new-tournament',
      params: { groupId: GROUP_ID },
    });
  });

  it('hides manager actions from ordinary members', async () => {
    mockGroup('MEMBER');
    api.listInvitedPlayers.mockResolvedValue([]);
    await renderWithClient(<GroupScreen id={GROUP_ID} />);
    expect(await screen.findByTestId('group-name')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New tournament in this group' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage members' })).toBeTruthy();
  });

  it('lets an ordinary member roster only placeholders they created', async () => {
    mockGroup('MEMBER');
    signedIn(jordan);
    api.listGroupPlayers.mockResolvedValue([]);
    const river = person('guest-river', 'PLACEHOLDER');
    api.listInvitedPlayers.mockResolvedValue([
      {
        user: river,
        status: 'ACTIVE',
        claimExpiresAt: '2026-12-05T12:00:00.000Z',
        claimRevokedAt: null,
        claimedAt: null,
      },
    ]);
    api.listUsers.mockResolvedValue([robin, river]);
    await renderWithClient(<GroupScreen id={GROUP_ID} />);
    await fireEvent.changeText(
      await screen.findByLabelText('Find an unclaimed player to add'),
      'guest',
    );
    expect(await screen.findByLabelText('Add guest-river to the group')).toBeTruthy();
    expect(screen.queryByLabelText('Add guest-robin to the group')).toBeNull();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  it('says when no unclaimed player is on the roster', async () => {
    mockGroup('OWNER');
    api.listGroupPlayers.mockResolvedValue([]);
    await renderWithClient(<GroupScreen id={GROUP_ID} />);
    expect(await screen.findByText(NO_UNCLAIMED_TEXT)).toBeTruthy();
  });

  it('adds an existing unclaimed player to the roster', async () => {
    mockGroup('ADMIN');
    api.listGroupPlayers.mockResolvedValue([]);
    api.listUsers.mockResolvedValue([sam, robin]);
    api.addGroupPlayer.mockResolvedValue(roster[0]!);
    await renderWithClient(<GroupScreen id={GROUP_ID} />);
    await fireEvent.changeText(
      await screen.findByLabelText('Find an unclaimed player to add'),
      'rob',
    );
    await fireEvent.press(await screen.findByLabelText('Add guest-robin to the group'));
    await waitFor(() => expect(api.addGroupPlayer).toHaveBeenCalledWith(GROUP_ID, robin.id));
    expect(screen.queryByLabelText('Add dev-sam to the group')).toBeNull();
  });

  it('shows the ordinary not-found state for an inaccessible group and drops its cache', async () => {
    api.getGroup.mockRejectedValue(notFound());
    api.listGroupMembers.mockRejectedValue(notFound());
    api.listGroupTournaments.mockRejectedValue(notFound());
    api.listGroupPlayers.mockRejectedValue(notFound());
    // Cached while the user was still a member.
    await renderWithClient(<GroupScreen id={GROUP_ID} />, (c) => {
      c.setQueryData(groupKeys.tournaments(GROUP_ID), [cup]);
      c.setQueryData(tournamentKeys.stats(cup.name), [stat(sam, cup, 1016)]);
    });
    expect(await screen.findByText(GROUP_NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByText('Shark Tank')).toBeNull();
    expect(screen.queryByText('Shark Tank Cup')).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(tournamentKeys.stats(cup.name))).toBeUndefined(),
    );
  });
});

describe('Members', () => {
  it('lets the owner promote a member and transfer ownership after confirmation', async () => {
    mockGroup('OWNER');
    api.setGroupMemberRole.mockResolvedValue(member(jordan, 'ADMIN'));
    api.transferGroupOwnership.mockResolvedValue(group('ADMIN'));
    await renderWithClient(<GroupMembersScreen id={GROUP_ID} />);

    await fireEvent.press(await screen.findByTestId('member-dev-jordan-make-admin'));
    await waitFor(() =>
      expect(api.setGroupMemberRole).toHaveBeenCalledWith(GROUP_ID, jordan.id, 'ADMIN'),
    );
    expect(await screen.findByTestId('members-notice')).toHaveTextContent('Jordan is now admin.');
    expect(screen.getByTestId('member-dev-sam-make-member')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('member-dev-sam-make-owner'));
    expect(api.transferGroupOwnership).not.toHaveBeenCalled();
    const dialog = screen.getByTestId('confirm-dialog');
    await fireEvent.press(within(dialog).getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => expect(api.transferGroupOwnership).toHaveBeenCalledWith(GROUP_ID, sam.id));
  });

  it('lets an admin remove only ordinary members', async () => {
    mockGroup('ADMIN');
    signedIn(sam);
    api.removeGroupMember.mockResolvedValue(undefined);
    await renderWithClient(<GroupMembersScreen id={GROUP_ID} />);

    expect(await screen.findByTestId('member-dev-jordan-remove')).toBeTruthy();
    expect(screen.queryByTestId('member-dev-jordan-make-admin')).toBeNull();
    expect(screen.queryByTestId('member-dev-alex-remove')).toBeNull();
    expect(screen.queryByTestId('member-dev-sam-remove')).toBeNull();

    await fireEvent.press(screen.getByTestId('member-dev-jordan-remove'));
    await fireEvent.press(
      within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => expect(api.removeGroupMember).toHaveBeenCalledWith(GROUP_ID, jordan.id));
  });

  it('gives members only Leave, and leaving evicts the group and returns to My groups', async () => {
    mockGroup('MEMBER');
    signedIn(jordan);
    api.leaveGroup.mockResolvedValue(undefined);
    await renderWithClient(<GroupMembersScreen id={GROUP_ID} />);

    expect(await screen.findByTestId('member-dev-alex')).toBeTruthy();
    expect(screen.queryByText('Remove')).toBeNull();
    expect(screen.queryByText('Make admin')).toBeNull();
    client.setQueryData(groupKeys.tournaments(GROUP_ID), [cup]);
    client.setQueryData(tournamentKeys.stats(cup.name), [stat(sam, cup, 1016)]);

    await fireEvent.press(screen.getByTestId('leave-group'));
    await fireEvent.press(
      within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: 'Leave group' }),
    );
    await waitFor(() => expect(mockedRouter.replace).toHaveBeenCalledWith('/groups'));
    expect(api.leaveGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(client.getQueryData(tournamentKeys.stats(cup.name))).toBeUndefined();
    expect(client.getQueryData(groupKeys.tournaments(GROUP_ID))).toBeUndefined();
  });

  it('tells the owner to transfer ownership before leaving', async () => {
    mockGroup('OWNER');
    api.leaveGroup.mockRejectedValue(
      new ApiError(400, 'OWNER_TRANSFER_REQUIRED', 'Transfer ownership first'),
    );
    await renderWithClient(<GroupMembersScreen id={GROUP_ID} />);
    await fireEvent.press(await screen.findByTestId('leave-group'));
    await fireEvent.press(
      within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: 'Leave group' }),
    );
    expect(await screen.findByTestId('members-error')).toHaveTextContent(OWNER_MUST_TRANSFER_TEXT);
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });
});

describe('Invites', () => {
  const issued = {
    id: 'inv-1',
    url: 'https://sharkulator.example/join/tok-1',
    code: 'ABCD234XYZ',
    expiresAt: '2026-12-05T12:00:00.000Z',
    createdAt: '2026-11-05T12:00:00.000Z',
  };
  const listed: GroupInvite = {
    id: 'inv-1',
    status: 'ACTIVE',
    createdBy: alex,
    createdAt: issued.createdAt,
    expiresAt: issued.expiresAt,
    revokedAt: null,
  };

  it('is hidden from ordinary members', async () => {
    api.getGroup.mockResolvedValue(group('MEMBER'));
    await renderWithClient(<GroupInviteScreen id={GROUP_ID} />);
    expect(await screen.findByText(INVITE_MANAGERS_ONLY_TEXT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create invite' })).toBeNull();
    expect(api.listGroupInvites).not.toHaveBeenCalled();
  });

  it('issues a link, code and QR once, and revokes after confirmation', async () => {
    api.getGroup.mockResolvedValue(group('ADMIN'));
    api.listGroupInvites.mockResolvedValueOnce([]).mockResolvedValue([listed]);
    api.createGroupInvite.mockResolvedValue(issued);
    api.revokeGroupInvite.mockResolvedValue(undefined);
    await renderWithClient(<GroupInviteScreen id={GROUP_ID} />);

    await fireEvent.press(await screen.findByLabelText('Never expires'));
    await fireEvent.press(screen.getByRole('button', { name: 'Create invite' }));
    await waitFor(() =>
      expect(api.createGroupInvite).toHaveBeenCalledWith(GROUP_ID, { expiresAt: null }),
    );
    expect(await screen.findByTestId('issued-invite-code')).toHaveTextContent('ABCD234XYZ');
    expect(screen.getAllByText(issued.url).length).toBeGreaterThan(0);
    expect(screen.getByTestId('qr-svg')).toHaveTextContent(issued.url);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share invite' })).toBeTruthy();

    await fireEvent.press(await screen.findByTestId('group-invite-inv-1-revoke'));
    expect(api.revokeGroupInvite).not.toHaveBeenCalled();
    await fireEvent.press(
      within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: 'Revoke invite' }),
    );
    await waitFor(() => expect(api.revokeGroupInvite).toHaveBeenCalledWith(GROUP_ID, 'inv-1'));
    await waitFor(() => expect(screen.queryByTestId('issued-invite')).toBeNull());
  });
});

describe('Join link', () => {
  const TOKEN = 'tok-abc';

  it('previews signed out and keeps the invitation for after sign-in without joining', async () => {
    signedOut();
    api.getGroupInvitePreview.mockResolvedValue({ groupName: 'Shark Tank', expiresAt: null });
    await renderWithClient(<JoinLinkScreen token={TOKEN} />);

    expect(await screen.findByText("You're invited to join Shark Tank")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in to join' }));
    await waitFor(() =>
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/login',
        params: { mode: 'signin' },
      }),
    );
    expect(await readPendingJoin()).toMatchObject({ token: TOKEN, groupName: 'Shark Tank' });
    expect(api.joinGroup).not.toHaveBeenCalled();
  });

  it('joins only when a signed-in user confirms, then opens the group', async () => {
    await savePendingJoin({ token: TOKEN, groupName: 'Shark Tank' });
    api.getGroupInvitePreview.mockResolvedValue({ groupName: 'Shark Tank', expiresAt: null });
    api.joinGroup.mockResolvedValue({ group: group('MEMBER'), role: 'MEMBER', joined: true });
    await renderWithClient(<JoinLinkScreen token={TOKEN} />);

    expect(await screen.findByText('Join Shark Tank?')).toBeTruthy();
    expect(api.joinGroup).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Join group' }));
    await waitFor(() =>
      expect(mockedRouter.replace).toHaveBeenCalledWith({
        pathname: '/groups/[id]',
        params: { id: GROUP_ID },
      }),
    );
    expect(api.joinGroup).toHaveBeenCalledWith({ token: TOKEN });
    await waitFor(() => expect(mockSecureStore.has(PENDING_JOIN_KEY)).toBe(false));
  });

  it('cancel clears the pending invitation without joining', async () => {
    await savePendingJoin({ token: TOKEN, groupName: 'Shark Tank' });
    api.getGroupInvitePreview.mockResolvedValue({ groupName: 'Shark Tank', expiresAt: null });
    await renderWithClient(<JoinLinkScreen token={TOKEN} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mockSecureStore.has(PENDING_JOIN_KEY)).toBe(false));
    expect(mockedRouter.replace).toHaveBeenCalledWith('/groups');
    expect(api.joinGroup).not.toHaveBeenCalled();
  });

  it('shows an unusable link for revoked or unknown tokens and drops the intent', async () => {
    await savePendingJoin({ token: TOKEN, groupName: 'Shark Tank' });
    api.getGroupInvitePreview.mockRejectedValue(
      new ApiError(404, 'INVITE_NOT_FOUND', 'Invite not found'),
    );
    await renderWithClient(<JoinLinkScreen token={TOKEN} />);
    expect(await screen.findByText(JOIN_LINK_INVALID_TITLE)).toBeTruthy();
    expect(screen.queryByText(/Shark Tank/)).toBeNull();
    await waitFor(() => expect(mockSecureStore.has(PENDING_JOIN_KEY)).toBe(false));
  });
});

describe('Join with a code', () => {
  it('normalizes the typed code and joins', async () => {
    api.joinGroup.mockResolvedValue({ group: group('MEMBER'), role: 'MEMBER', joined: true });
    await renderWithClient(<JoinCodeScreen />);
    await fireEvent.changeText(screen.getByLabelText('Invite code'), 'abcd-234 xyz');
    await fireEvent.press(screen.getByRole('button', { name: 'Join group' }));
    await waitFor(() => expect(api.joinGroup).toHaveBeenCalledWith({ code: 'ABCD234XYZ' }));
    expect(mockedRouter.replace).toHaveBeenCalledWith({
      pathname: '/groups/[id]',
      params: { id: GROUP_ID },
    });
  });

  it('explains an invalid code without revealing anything', async () => {
    api.joinGroup.mockRejectedValue(new ApiError(400, 'INVITE_INVALID', 'Invite is not valid'));
    await renderWithClient(<JoinCodeScreen />);
    await fireEvent.changeText(screen.getByLabelText('Invite code'), 'zzzz');
    await fireEvent.press(screen.getByRole('button', { name: 'Join group' }));
    expect(await screen.findByText(JOIN_CODE_INVALID_TEXT)).toBeTruthy();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps the code across sign-in and asks for confirmation afterwards', async () => {
    signedOut();
    const view = await renderWithClient(<JoinCodeScreen key="signed-out" />);
    await fireEvent.changeText(screen.getByLabelText('Invite code'), 'abcd234xyz');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in to join' }));
    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalled());
    expect(await readPendingJoin()).toMatchObject({ code: 'ABCD234XYZ' });

    signedIn(jordan);
    await view.rerender(
      <QueryClientProvider client={client}>
        <JoinCodeScreen key="signed-in" />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('join-code-resumed')).toBeTruthy();
    expect(screen.getByLabelText('Invite code')).toHaveDisplayValue('ABCD234XYZ');
    expect(api.joinGroup).not.toHaveBeenCalled();
  });
});

describe('Resuming a pending join after sign-in', () => {
  it('reopens the invitation once the signed-in navigator settled', async () => {
    await savePendingJoin({ token: 'tok-1', groupName: 'Shark Tank' });
    mockedPathname.mockReturnValue('/login');
    const hook = await renderHook(
      ({ account }: { account: string | null }) => usePendingJoinResume(true, account),
      { initialProps: { account: 'u-jordan' } },
    );
    await act(async () => undefined);
    expect(mockedRouter.push).not.toHaveBeenCalled();

    mockedPathname.mockReturnValue('/feed');
    await hook.rerender({ account: 'u-jordan' });
    await waitFor(() =>
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/join/[token]',
        params: { token: 'tok-1' },
      }),
    );
    await hook.rerender({ account: 'u-jordan' });
    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
  });

  it('reopens code entry for a pending code and does nothing without an intent', async () => {
    await savePendingJoin({ code: 'ABCD234XYZ' });
    await renderHook(() => usePendingJoinResume(true, 'u-jordan'));
    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalledWith('/join'));

    mockedRouter.push.mockClear();
    mockSecureStore.clear();
    await renderHook(() => usePendingJoinResume(true, 'u-sam'));
    await act(async () => undefined);
    expect(mockedRouter.push).not.toHaveBeenCalled();
  });

  it('shows the invitation on the login screen and cancelling clears it', async () => {
    signedOut();
    await savePendingJoin({ token: 'tok-1', groupName: 'Shark Tank' });
    await render(<LoginScreen devSignInEnabled={false} />);
    expect(await screen.findByText(/Sign in to join Shark Tank/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel joining' }));
    await waitFor(() => expect(mockSecureStore.has(PENDING_JOIN_KEY)).toBe(false));
    expect(screen.queryByTestId('pending-join')).toBeNull();
  });
});

describe('New tournament group picker', () => {
  it('offers managed groups only and creates the tournament in the chosen group', async () => {
    api.listSports.mockResolvedValue([]);
    api.listGroups.mockResolvedValue([
      group('ADMIN'),
      group('MEMBER', { id: 'g-member', name: 'Bar League' }),
    ]);
    api.createTournament.mockResolvedValue(cup);
    const onCreated = jest.fn();
    await renderWithClient(<CreateTournamentScreen onCreated={onCreated} />);

    expect(await screen.findByLabelText('Group Shark Tank')).toBeTruthy();
    expect(screen.queryByLabelText('Group Bar League')).toBeNull();
    expect(screen.getByLabelText('Open to everyone')).toBeSelected();

    await fireEvent.press(screen.getByLabelText('Group Shark Tank'));
    expect(screen.getByTestId('tournament-group-hint')).toHaveTextContent(
      'Only members of Shark Tank will see this tournament.',
    );
    await fireEvent.changeText(screen.getByLabelText('Tournament Title'), 'Shark Tank Cup');
    await fireEvent.changeText(screen.getByLabelText('Sport'), 'darts');
    await fireEvent.press(screen.getByRole('button', { name: 'Create Tournament' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(cup));
    expect(api.createTournament).toHaveBeenCalledWith({
      displayName: 'Shark Tank Cup',
      sportName: 'darts',
      groupId: GROUP_ID,
    });
  });
});

describe('Grouped game entry', () => {
  beforeEach(() => {
    useGameFormStore.setState({
      owner: 'dev-alex',
      tournament: cup,
      outcomes: [{ username: 'dev-alex', result: 'WIN' }],
    });
  });

  it('offers only group members and unclaimed players of the group', async () => {
    api.listGroupMembers.mockResolvedValue(members);
    api.listGroupPlayers.mockResolvedValue(roster);
    api.listUsers.mockResolvedValue([person('dev-taylor')]);
    await renderWithClient(<AddPlayers ownerId={alex.id} />);

    expect(screen.getByTestId('add-players-group')).toHaveTextContent(/Shark Tank tournament/);
    await fireEvent.changeText(screen.getByLabelText('Find a player'), 'dev');
    expect(await screen.findByLabelText('Add dev-sam')).toBeTruthy();
    expect(screen.getByLabelText('Add dev-jordan')).toBeTruthy();
    expect(screen.queryByLabelText('Add dev-taylor')).toBeNull();
    expect(api.listUsers).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Find a player'), 'robin');
    expect(await screen.findByLabelText('Add guest-robin')).toBeTruthy();
  });

  it('adds a new player by name to the group roster', async () => {
    api.createPlaceholder.mockResolvedValue({
      user: person('guest-river', 'PLACEHOLDER'),
      claimUrl: 'http://localhost:8083/invite/claim/river',
      claimExpiresAt: '2026-12-05T12:00:00.000Z',
    });
    await renderWithClient(<AddPlayers ownerId={alex.id} />);
    await fireEvent.changeText(screen.getByLabelText('New player name'), 'River');
    await fireEvent.press(screen.getByTestId('placeholder-add'));
    await waitFor(() =>
      expect(api.createPlaceholder).toHaveBeenCalledWith({
        displayName: 'River',
        groupId: GROUP_ID,
      }),
    );
  });
});
