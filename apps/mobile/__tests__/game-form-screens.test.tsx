import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CameraView, useCameraPermissions, type PermissionResponse } from 'expo-camera';
import { router } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Platform } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, Tournament, User } from '@/api/types';
import { DropdownAlert, useAlertStore } from '@/components/dropdown-alert';
import { CAMERA_DENIED_TEXT, CAMERA_UNAVAILABLE_TEXT } from '@/components/qr-scanner';
import { GAME_OVER_TEXT, GameChoiceScreen } from '@/features/game-form/choice-screen';
import { CONFIRM_MESSAGE, ScannerScreen } from '@/features/game-form/scanner-screen';
import { useGameFormStore } from '@/features/game-form/store';
import { TournamentPickerScreen } from '@/features/game-form/tournament-picker-screen';
import { WinnerScreen } from '@/features/game-form/winner-screen';
import { gameKeys } from '@/features/games/queries';
import { statsKeys, userKeys } from '@/features/users/queries';
import { buildQrPayload, encodeQrPayload, WRONG_TOURNAMENT_MESSAGE } from '@/lib/qr';

jest.mock('@/api/endpoints');
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    navigate: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ value, size }: { value: string; size: number }) => (
      <Text testID="qr-svg">{`${size}:${value}`}</Text>
    ),
  };
});
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const CameraView = Object.assign(
    jest.fn((props: object) => <View testID="camera-view" {...props} />),
    { isAvailableAsync: jest.fn() },
  );
  return { CameraView, useCameraPermissions: jest.fn() };
});

const api = jest.mocked(endpoints);
const mockedRouter = jest.mocked(router);
const mockedCamera = jest.mocked(CameraView);
const mockedPermissions = jest.mocked(useCameraPermissions);

const user = (username: string): User => ({
  id: `id-${username}`,
  username,
  accountType: 'REGISTERED',
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const tournament = (name: string, displayName: string): Tournament => ({
  id: `t-${name}`,
  name,
  displayName,
  isOver: false,
  sport: { id: 's-babyfoot', name: 'babyfoot' },
  owner: null,
});

const babyfoot = tournament('officebabyfoot', 'Office Babyfoot');
const darts = tournament('lunchdarts', 'Lunch Darts');

const game = (id: string, t: Tournament = babyfoot): Game => ({
  id,
  date: new Date(Date.now() - 60_000).toISOString(),
  tournament: t,
  outcomes: [
    { id: `${id}-w`, result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: user('dev-alex') },
    { id: `${id}-l`, result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: user('dev-sam') },
  ],
});

const permission = (overrides: Partial<PermissionResponse>): PermissionResponse =>
  ({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
    ...overrides,
  }) as PermissionResponse;

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

const requestPermission = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  mockedRouter.canGoBack.mockReturnValue(true);
  useAlertStore.setState({ current: null });
  useGameFormStore.setState({ owner: null, tournament: null, outcomes: [] });
  // The real CameraView is a class; a null-rendering stub keeps the recorded props inspectable.
  mockedCamera.mockImplementation((() => null) as never);
  jest.mocked(CameraView.isAvailableAsync).mockResolvedValue(true);
  mockedPermissions.mockReturnValue([permission({}), requestPermission, jest.fn()]);
  api.getUserGames.mockResolvedValue([game('g-latest')]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GameChoiceScreen', () => {
  it('asks won or lost without a tie option', async () => {
    await renderWithClient(<GameChoiceScreen />);
    expect(screen.getByText(GAME_OVER_TEXT)).toBeTruthy();
    expect(screen.queryByText(/tie/i)).toBeNull();
    await fireEvent.press(screen.getByLabelText('WON'));
    expect(mockedRouter.push).toHaveBeenCalledWith('/game-form/winner');
    await fireEvent.press(screen.getByLabelText('LOST'));
    expect(mockedRouter.push).toHaveBeenCalledWith('/game-form/scanner');
  });
});

describe('WinnerScreen', () => {
  it("shows a 220px QR of the winner payload for the latest game's tournament", async () => {
    await renderWithClient(<WinnerScreen username="dev-alex" />);
    const expected = encodeQrPayload(buildQrPayload('dev-alex', 'officebabyfoot', 'WIN'));
    expect(await screen.findByTestId('qr-svg')).toHaveTextContent(`220:${expected}`);
    expect(screen.getByTestId('qr-payload')).toHaveTextContent(expected);
    expect(screen.getByText('Office Babyfoot')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('EDIT'));
    expect(mockedRouter.push).toHaveBeenCalledWith('/game-form/tournament');
  });

  it('changes the payload when another tournament is picked', async () => {
    await renderWithClient(<WinnerScreen username="dev-alex" />);
    await screen.findByTestId('qr-svg');
    await waitFor(() => useGameFormStore.getState().selectTournament(darts));
    expect(await screen.findByText('Lunch Darts')).toBeTruthy();
    expect(screen.getByTestId('qr-svg')).toHaveTextContent(
      `220:${encodeQrPayload(buildQrPayload('dev-alex', 'lunchdarts', 'WIN'))}`,
    );
  });

  it('asks to select a tournament when the player has no game yet', async () => {
    api.getUserGames.mockResolvedValue([]);
    await renderWithClient(<WinnerScreen username="dev-alex" />);
    await fireEvent.press(await screen.findByLabelText('Select a tournament'));
    expect(mockedRouter.push).toHaveBeenCalledWith('/game-form/tournament');
    expect(screen.queryByTestId('qr-svg')).toBeNull();
  });
});

describe('TournamentPickerScreen', () => {
  it('lists recent and all tournaments, filters them and picks one into the draft', async () => {
    api.getUserTournaments.mockResolvedValue([babyfoot]);
    api.listTournaments.mockResolvedValue([babyfoot, darts]);
    useGameFormStore.getState().start('dev-alex');
    await renderWithClient(<TournamentPickerScreen username="dev-alex" />);

    expect(await screen.findByText('RECENT TOURNAMENTS')).toBeTruthy();
    expect(await screen.findByText('ALL TOURNAMENTS')).toBeTruthy();
    expect(screen.getAllByText('Office Babyfoot')).toHaveLength(2);

    await fireEvent.changeText(screen.getByTestId('search-bar'), 'darts');
    expect(screen.queryByText('RECENT TOURNAMENTS')).toBeNull();
    expect(screen.queryByText('Office Babyfoot')).toBeNull();
    await fireEvent.press(screen.getByTestId('tournament-row-lunchdarts'));

    expect(useGameFormStore.getState().tournament).toBe(darts);
    expect(mockedRouter.back).toHaveBeenCalled();
  });
});

describe('ScannerScreen', () => {
  const winnerCode = encodeQrPayload(buildQrPayload('dev-alex', 'officebabyfoot', 'WIN'));

  async function renderScanner() {
    await renderWithClient(<ScannerScreen username="dev-sam" />);
    await screen.findByTestId('scanner-review-game');
  }

  const scan = (data: string) => {
    const props = mockedCamera.mock.lastCall?.[0];
    if (!props?.onBarcodeScanned) throw new Error('camera not rendered');
    props.onBarcodeScanned({ data } as Parameters<NonNullable<typeof props.onBarcodeScanned>>[0]);
  };

  it('renders the QR camera and accumulates scans seeded with the own LOSS', async () => {
    await renderScanner();
    await waitFor(() => expect(mockedCamera).toHaveBeenCalled());
    expect(mockedCamera.mock.lastCall?.[0].barcodeScannerSettings).toStrictEqual({
      barcodeTypes: ['qr'],
    });
    expect(screen.queryByTestId('scanned-outcomes')).toBeNull();
    expect(screen.getByLabelText('Review game')).toBeDisabled();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    await waitFor(() => scan(winnerCode));
    expect(await screen.findByTestId('game-confirmation-summary')).toHaveTextContent(
      /^Office Babyfootbabyfoot/,
    );
    expect(screen.getByTestId('game-confirmation-outcomes-winners')).toHaveTextContent('dev-alex');
    expect(screen.getByTestId('game-confirmation-outcomes-losers')).toHaveTextContent('dev-sam');
    expect(screen.getByLabelText('Confirm game')).toBeEnabled();
    expect(screen.queryByTestId('scanner-camera')).toBeNull();
    expect(api.submitGame).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await waitFor(() => expect(screen.getByTestId('scanner-camera')).toBeTruthy());
    expect(screen.getByTestId('dropdown-alert')).toHaveTextContent(
      'Scanneddev-alex added as winner.',
    );
    expect(screen.getByLabelText('Review game')).toBeEnabled();

    await waitFor(() => scan(encodeQrPayload(buildQrPayload('dev-jordan', 'lunchdarts', 'WIN'))));
    expect(await screen.findByText(WRONG_TOURNAMENT_MESSAGE)).toBeTruthy();
    expect(useGameFormStore.getState().outcomes).toStrictEqual([
      { username: 'dev-sam', result: 'LOSS' },
      { username: 'dev-alex', result: 'WIN' },
    ]);
  });

  it('accepts a pasted code in dev builds through the same scan handler', async () => {
    await renderScanner();
    await fireEvent.changeText(screen.getByTestId('manual-code-input'), winnerCode);
    await fireEvent.press(screen.getByLabelText('Add code'));
    expect(await screen.findByTestId('game-confirmation-summary')).toHaveTextContent(/dev-alex/);
  });

  it('waits for complete teams and includes every player in the popup', async () => {
    await renderScanner();
    await waitFor(() =>
      scan(encodeQrPayload(buildQrPayload('dev-jordan', 'officebabyfoot', 'LOSS'))),
    );
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    await waitFor(() => scan(winnerCode));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(screen.getByLabelText('Review game')).toBeDisabled();
    await waitFor(() => scan(encodeQrPayload(buildQrPayload('dev-lee', 'officebabyfoot', 'WIN'))));
    expect(await screen.findByTestId('game-confirmation-outcomes-winners')).toHaveTextContent(
      'dev-alexdev-lee',
    );
    expect(screen.getByTestId('game-confirmation-outcomes-losers')).toHaveTextContent(
      'dev-samdev-jordan',
    );
    expect(api.submitGame).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await waitFor(() => expect(screen.getByTestId('scanner-camera')).toBeTruthy());
    await waitFor(() => scan(winnerCode));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(useGameFormStore.getState().outcomes).toHaveLength(4);
  });

  it('submits only after confirmation, opens the result and invalidates feed queries', async () => {
    const created = game('g-new');
    api.submitGame.mockResolvedValue(created);
    await renderScanner();
    await fireEvent.changeText(screen.getByTestId('manual-code-input'), winnerCode);
    await fireEvent.press(screen.getByLabelText('Add code'));
    await screen.findByTestId('game-confirmation-summary');
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    expect(screen.getByText(CONFIRM_MESSAGE)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(screen.queryByText(CONFIRM_MESSAGE)).toBeNull();
    expect(api.submitGame).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Review game'));
    expect(screen.getByTestId('game-confirmation-outcomes-winners')).toHaveTextContent('dev-alex');
    expect(screen.getByTestId('game-confirmation-outcomes-losers')).toHaveTextContent('dev-sam');
    await fireEvent.press(screen.getByLabelText('Confirm game'));
    await waitFor(() =>
      expect(mockedRouter.replace).toHaveBeenCalledWith({
        pathname: '/game-form/result',
        params: { id: 'g-new' },
      }),
    );
    expect(api.submitGame).toHaveBeenCalledWith('officebabyfoot', {
      outcomes: [
        { username: 'dev-sam', result: 'LOSS' },
        { username: 'dev-alex', result: 'WIN' },
      ],
    });
    expect(client.getQueryData(gameKeys.detail('g-new'))).toBe(created);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: statsKeys.all });
    expect(useGameFormStore.getState().outcomes).toStrictEqual([
      { username: 'dev-sam', result: 'LOSS' },
    ]);
  });

  it('alerts and keeps the scans when the submission fails', async () => {
    api.submitGame.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Only a loser can submit'));
    await renderScanner();
    await fireEvent.changeText(screen.getByTestId('manual-code-input'), winnerCode);
    await fireEvent.press(screen.getByLabelText('Add code'));
    await fireEvent.press(screen.getByLabelText('Confirm game'));
    expect(
      await screen.findByText('Failed to submit the game: Only a loser can submit'),
    ).toBeTruthy();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
    expect(useGameFormStore.getState().outcomes).toHaveLength(2);
  });

  it('shows the own LOSS QR in get-scanned mode', async () => {
    await renderScanner();
    await fireEvent.press(screen.getByLabelText('Get Scanned'));
    expect(screen.getByTestId('qr-svg')).toHaveTextContent(
      `220:${encodeQrPayload(buildQrPayload('dev-sam', 'officebabyfoot', 'LOSS'))}`,
    );
    await fireEvent.press(screen.getByLabelText('Scan'));
    expect(screen.queryByTestId('qr-svg')).toBeNull();
  });

  it('requests permission and mounts the camera on iOS without the web-only availability probe', async () => {
    expect(Platform.OS).toBe('ios');
    jest
      .mocked(CameraView.isAvailableAsync)
      .mockRejectedValue(
        new Error('The method or property expo-camera.isAvailableAsync is not available on ios'),
      );
    mockedPermissions.mockImplementation(() => {
      const [current, setCurrent] = useState(
        permission({ status: 'undetermined' as PermissionResponse['status'], granted: false }),
      );
      const request = async () => {
        requestPermission();
        const granted = permission({});
        setCurrent(granted);
        return granted;
      };
      return [current, request, jest.fn()];
    });

    await renderScanner();
    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('scanner-camera')).toBeTruthy();
    expect(mockedCamera).toHaveBeenCalled();
    expect(CameraView.isAvailableAsync).not.toHaveBeenCalled();
    expect(screen.queryByText(CAMERA_UNAVAILABLE_TEXT)).toBeNull();
  });

  it('shows a camera-unavailable state when the web browser has no camera', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    jest.mocked(CameraView.isAvailableAsync).mockResolvedValue(false);
    await renderScanner();
    expect(await screen.findByText(CAMERA_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(mockedCamera).not.toHaveBeenCalled();
    expect(screen.getByTestId('manual-code-entry')).toBeTruthy();
  });

  it('shows a permission-denied state with a retry', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    mockedPermissions.mockReturnValue([
      permission({ status: 'denied' as PermissionResponse['status'], granted: false }),
      requestPermission,
      jest.fn(),
    ]);
    await renderScanner();
    expect(await screen.findByText(CAMERA_DENIED_TEXT)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(requestPermission).toHaveBeenCalled();
  });
});
