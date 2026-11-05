import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import type { ReactElement } from 'react';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { InvitedPlayer, User } from '@/api/types';
import SettingsScreen from '@/app/(app)/(tabs)/settings';
import { useSession } from '@/auth/session';
import { sessionStore } from '@/auth/session-store';
import { COPIED_TEXT, COPY_FAILED_TEXT } from '@/components/copyable-link';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import { AppInviteLanding, INVITE_INVALID_TITLE } from '@/features/invites/app-invite-landing';
import { AppInviteScreen } from '@/features/invites/app-invite-screen';
import {
  INVITED_LOAD_FAILED_TEXT,
  InvitedPlayersScreen,
  NO_INVITED_PLAYERS_TEXT,
} from '@/features/invites/invited-players-screen';
import {
  ISSUED_LINKS_KEY,
  clearIssuedLinks,
  hydrateIssuedLinks,
  rememberClaimLink,
  setIssuedLinksStorage,
  useIssuedLinksStore,
} from '@/features/invites/issued-links';

import { makeSession, memoryStorage } from '../test-utils/session';

jest.mock('@/api/endpoints');
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);
const mockedSession = jest.mocked(useSession);
const setString = jest.mocked(Clipboard.setStringAsync);

const ALEX = 'u-alex';
const SAM = 'u-sam';

const person = (username: string, accountType: User['accountType'] = 'PLACEHOLDER'): User => ({
  id: `id-${username}`,
  username,
  accountType,
  firstName: username.replace('guest-', '').replace(/^./, (c) => c.toUpperCase()),
  lastName: 'Guest',
  pictureUrl: null,
  locale: null,
});

const invited: InvitedPlayer[] = [
  {
    user: person('guest-riley'),
    status: 'ACTIVE',
    claimExpiresAt: '2026-12-05T12:00:00.000Z',
    claimRevokedAt: null,
    claimedAt: null,
  },
  {
    user: person('guest-casey'),
    status: 'EXPIRED',
    claimExpiresAt: '2026-11-04T12:00:00.000Z',
    claimRevokedAt: null,
    claimedAt: null,
  },
  {
    user: person('guest-jamie'),
    status: 'REVOKED',
    claimExpiresAt: '2027-11-05T12:00:00.000Z',
    claimRevokedAt: '2026-11-05T12:00:00.000Z',
    claimedAt: null,
  },
  {
    user: person('guest-quinn', 'REGISTERED'),
    status: 'CLAIMED',
    claimExpiresAt: '2027-11-05T12:00:00.000Z',
    claimRevokedAt: null,
    claimedAt: '2026-11-05T12:00:00.000Z',
  },
];

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

let links: ReturnType<typeof memoryStorage>;

beforeEach(async () => {
  jest.resetAllMocks();
  useAlertStore.setState({ current: null });
  links = memoryStorage();
  setIssuedLinksStorage(links.storage);
  await clearIssuedLinks();
  mockedSession.mockReturnValue({
    status: 'authenticated',
    session: makeSession(),
    user: makeSession().user,
    loginWithGoogleCode: jest.fn(),
    loginWithDevUser: jest.fn(),
    logout: jest.fn(async () => undefined),
    refresh: jest.fn(),
  });
});

afterAll(() => setIssuedLinksStorage(null));

describe('Settings tab', () => {
  it('opens Invite to Sharkulator and Invited players while keeping logout', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByLabelText('Invite to Sharkulator'));
    expect(router.push).toHaveBeenCalledWith('/settings/invite');
    await fireEvent.press(screen.getByLabelText('Invited players'));
    expect(router.push).toHaveBeenCalledWith('/settings/invited-players');
    expect(screen.getByLabelText('LOGOUT')).toBeTruthy();
  });
});

describe('InvitedPlayersScreen', () => {
  it('shows each lifecycle status with its date and the applicable actions', async () => {
    api.listInvitedPlayers.mockResolvedValue(invited);
    await renderWithClient(<InvitedPlayersScreen ownerId={ALEX} />);

    expect(await screen.findByTestId('invited-player-guest-riley-status')).toHaveTextContent(
      'ACTIVE',
    );
    expect(screen.getByTestId('invited-player-guest-casey-status')).toHaveTextContent('EXPIRED');
    expect(screen.getByTestId('invited-player-guest-jamie-status')).toHaveTextContent('REVOKED');
    expect(screen.getByTestId('invited-player-guest-quinn-status')).toHaveTextContent('CLAIMED');
    expect(screen.getByText(/Link expires Dec 5, 2026/)).toBeTruthy();
    expect(screen.getByText(/Link expired Nov 4, 2026/)).toBeTruthy();
    expect(screen.getByText(/Link revoked Nov 5, 2026/)).toBeTruthy();
    expect(screen.getByText(/Claimed Nov 5, 2026/)).toBeTruthy();
    // Revoke only for active links; nothing to manage once claimed.
    expect(screen.getAllByLabelText('Revoke link')).toHaveLength(1);
    expect(screen.getAllByLabelText('Issue new link')).toHaveLength(2);
    expect(screen.getAllByLabelText('Get a new link')).toHaveLength(1);
  });

  it('shows an empty state for an account without invited players', async () => {
    api.listInvitedPlayers.mockResolvedValue([]);
    await renderWithClient(<InvitedPlayersScreen ownerId={SAM} />);
    expect(await screen.findByText(NO_INVITED_PLAYERS_TEXT)).toBeTruthy();
  });

  it('offers a retry when the list cannot load', async () => {
    api.listInvitedPlayers.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await renderWithClient(<InvitedPlayersScreen ownerId={ALEX} />);
    expect(await screen.findByText(INVITED_LOAD_FAILED_TEXT)).toBeTruthy();
    api.listInvitedPlayers.mockResolvedValue([]);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText(NO_INVITED_PLAYERS_TEXT)).toBeTruthy();
  });

  it('reissues an active link after confirmation and shows the new copyable URL', async () => {
    api.listInvitedPlayers.mockResolvedValue(invited);
    api.reissueClaimLink.mockResolvedValue({
      user: invited[0]!.user,
      claimUrl: 'http://localhost:8081/invite/claim/new-token',
      claimExpiresAt: '2026-12-06T12:00:00.000Z',
    });
    setString.mockResolvedValue(true);
    await renderWithClient(<InvitedPlayersScreen ownerId={ALEX} />);

    await fireEvent.press(await screen.findByLabelText('Get a new link'));
    expect(api.reissueClaimLink).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Get new link'));

    expect(await screen.findByTestId('claim-link-guest-riley-url')).toHaveTextContent(
      'http://localhost:8081/invite/claim/new-token',
    );
    expect(api.reissueClaimLink).toHaveBeenCalledWith('id-guest-riley');
    expect(api.listInvitedPlayers).toHaveBeenCalledTimes(2);

    await fireEvent.press(screen.getByLabelText('Copy link'));
    expect(setString).toHaveBeenCalledWith('http://localhost:8081/invite/claim/new-token');
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();
  });

  it('reissues an expired or revoked link without confirmation', async () => {
    api.listInvitedPlayers.mockResolvedValue(invited);
    api.reissueClaimLink.mockResolvedValue({
      user: invited[2]!.user,
      claimUrl: 'http://localhost:8081/invite/claim/jamie-2',
      claimExpiresAt: '2026-12-06T12:00:00.000Z',
    });
    await renderWithClient(<InvitedPlayersScreen ownerId={ALEX} />);
    const buttons = await screen.findAllByLabelText('Issue new link');
    await fireEvent.press(buttons[1]!);
    await waitFor(() => expect(api.reissueClaimLink).toHaveBeenCalledWith('id-guest-jamie'));
  });

  it('revokes an active link after confirmation and refreshes the list', async () => {
    api.listInvitedPlayers.mockResolvedValue(invited);
    api.revokeClaimLink.mockResolvedValue(undefined);
    rememberClaimLink(ALEX, 'id-guest-riley', {
      url: 'http://localhost:8081/invite/claim/old',
      expiresAt: '2026-12-05T12:00:00.000Z',
    });
    await renderWithClient(<InvitedPlayersScreen ownerId={ALEX} />);
    expect(await screen.findByTestId('claim-link-guest-riley-url')).toBeTruthy();

    api.listInvitedPlayers.mockResolvedValue([
      { ...invited[0]!, status: 'REVOKED', claimRevokedAt: '2026-11-06T12:00:00.000Z' },
    ]);
    await fireEvent.press(screen.getByLabelText('Revoke link'));
    await fireEvent.press(screen.getByLabelText('Revoke'));

    expect(await screen.findByText(/Link revoked Nov 6, 2026/)).toBeTruthy();
    expect(api.revokeClaimLink).toHaveBeenCalledWith('id-guest-riley');
    expect(screen.queryByTestId('claim-link-guest-riley-url')).toBeNull();
    expect(useIssuedLinksStore.getState().claims['id-guest-riley']).toBeUndefined();
  });

  it('reports a failed copy instead of claiming success', async () => {
    api.listInvitedPlayers.mockResolvedValue(invited);
    rememberClaimLink(ALEX, 'id-guest-riley', {
      url: 'http://localhost:8081/invite/claim/held',
      expiresAt: '2026-12-05T12:00:00.000Z',
    });
    setString.mockRejectedValue(new Error('Document is not focused'));
    await renderWithClient(<InvitedPlayersScreen ownerId={ALEX} />);
    await fireEvent.press(await screen.findByLabelText('Copy link'));
    expect(await screen.findByText(COPY_FAILED_TEXT)).toBeTruthy();
    expect(screen.queryByText(COPIED_TEXT)).toBeNull();
  });
});

describe('issued links', () => {
  it('are scoped to the account that issued them and wiped on sign-out', async () => {
    rememberClaimLink(ALEX, 'p1', { url: 'http://x/invite/claim/1', expiresAt: 'later' });
    await waitFor(() => expect(links.data.has(ISSUED_LINKS_KEY)).toBe(true));

    // Another account never sees alex's links, even from storage.
    useIssuedLinksStore.setState({
      ownerId: null,
      hydrated: false,
      appInviteUrl: null,
      claims: {},
    });
    await hydrateIssuedLinks(SAM);
    expect(useIssuedLinksStore.getState().claims).toEqual({});
    expect(useIssuedLinksStore.getState().ownerId).toBe(SAM);

    useIssuedLinksStore.setState({
      ownerId: null,
      hydrated: false,
      appInviteUrl: null,
      claims: {},
    });
    await hydrateIssuedLinks(ALEX);
    expect(useIssuedLinksStore.getState().claims.p1?.url).toBe('http://x/invite/claim/1');

    await act(async () => {
      await sessionStore.clear();
    });
    await waitFor(() => expect(links.data.has(ISSUED_LINKS_KEY)).toBe(false));
    expect(useIssuedLinksStore.getState().claims).toEqual({});
  });
});

describe('AppInviteScreen', () => {
  it('issues the invitation, copies it and rotates it only after confirmation', async () => {
    api.issueAppInvite
      .mockResolvedValueOnce({ url: 'http://localhost:8081/invite/app/first' })
      .mockResolvedValueOnce({ url: 'http://localhost:8081/invite/app/second' });
    setString.mockResolvedValue(true);
    await renderWithClient(<AppInviteScreen ownerId={ALEX} />);

    await waitFor(() => expect(screen.getByLabelText('Create invite link')).toBeEnabled());
    await fireEvent.press(screen.getByLabelText('Create invite link'));
    expect(await screen.findByTestId('app-invite-link-url')).toHaveTextContent(
      'http://localhost:8081/invite/app/first',
    );
    expect(screen.getByTestId('app-invite-link-url')).not.toHaveTextContent(/invite\/claim/);

    await fireEvent.press(screen.getByLabelText('Copy link'));
    expect(setString).toHaveBeenCalledWith('http://localhost:8081/invite/app/first');
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Get a new link'));
    expect(api.issueAppInvite).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByLabelText('Get new link'));
    expect(await screen.findByText('http://localhost:8081/invite/app/second')).toBeTruthy();
    expect(api.issueAppInvite).toHaveBeenCalledTimes(2);
  });

  it('shows the remembered link without issuing a new one', async () => {
    links.data.set(
      ISSUED_LINKS_KEY,
      JSON.stringify({
        ownerId: ALEX,
        appInviteUrl: 'http://localhost:8081/invite/app/kept',
        claims: {},
      }),
    );
    await renderWithClient(<AppInviteScreen ownerId={ALEX} />);
    expect(await screen.findByText('http://localhost:8081/invite/app/kept')).toBeTruthy();
    expect(api.issueAppInvite).not.toHaveBeenCalled();
  });

  it('reports a failed copy honestly', async () => {
    api.issueAppInvite.mockResolvedValue({ url: 'http://localhost:8081/invite/app/first' });
    setString.mockResolvedValue(false);
    await renderWithClient(<AppInviteScreen ownerId={ALEX} />);
    await waitFor(() => expect(screen.getByLabelText('Create invite link')).toBeEnabled());
    await fireEvent.press(screen.getByLabelText('Create invite link'));
    await fireEvent.press(await screen.findByLabelText('Copy link'));
    expect(await screen.findByText(COPY_FAILED_TEXT)).toBeTruthy();
  });
});

describe('AppInviteLanding', () => {
  const signedOut = () =>
    mockedSession.mockReturnValue({
      status: 'unauthenticated',
      session: null,
      user: null,
      loginWithGoogleCode: jest.fn(),
      loginWithDevUser: jest.fn(),
      logout: jest.fn(),
      refresh: jest.fn(),
    });

  it('is public, names the inviter and continues to the normal sign-in', async () => {
    signedOut();
    api.getAppInvitePreview.mockResolvedValue({ invitedBy: person('dev-alex', 'REGISTERED') });
    await renderWithClient(<AppInviteLanding token="tok" />);

    expect(await screen.findByTestId('app-invite-title')).toHaveTextContent(
      'Dev-alex Guest invited you to Sharkulator',
    );
    await fireEvent.press(screen.getByLabelText('Sign in to get started'));
    expect(router.push).toHaveBeenCalledWith('/login');
    expect(api.getAppInvitePreview).toHaveBeenCalledWith('tok');
    // Opening the invitation never claims or signs anyone in.
    expect(api.exchangeGoogleCode).not.toHaveBeenCalled();
    expect(api.getClaimPreview).not.toHaveBeenCalled();
  });

  it('shows a clear invalid-invitation screen for 404 INVITE_NOT_FOUND', async () => {
    signedOut();
    api.getAppInvitePreview.mockRejectedValue(new ApiError(404, 'INVITE_NOT_FOUND', 'nope'));
    await renderWithClient(<AppInviteLanding token="bad" />);
    expect(await screen.findByText(INVITE_INVALID_TITLE)).toBeTruthy();
    expect(screen.queryByLabelText('Sign in to get started')).toBeNull();
    expect(api.getAppInvitePreview).toHaveBeenCalledTimes(1);
  });

  it('sends a signed-in visitor to the app', async () => {
    api.getAppInvitePreview.mockResolvedValue({ invitedBy: person('dev-alex', 'REGISTERED') });
    await renderWithClient(<AppInviteLanding token="tok" />);
    await fireEvent.press(await screen.findByLabelText('Open Sharkulator'));
    expect(router.replace).toHaveBeenCalledWith('/feed');
  });
});
