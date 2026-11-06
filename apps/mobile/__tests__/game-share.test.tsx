import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { Platform, Share } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Game, GameShare, Tournament, User } from '@/api/types';
import { COPIED_TEXT, COPY_FAILED_TEXT } from '@/components/copyable-link';
import { GameResultScreen } from '@/features/game-form/result-screen';
import { GameDetailScreen } from '@/features/games/game-detail-screen';
import {
  SHARE_DISCLOSURE_TEXT,
  SHARE_REVOKED_TEXT,
  SHARE_SHEET_FAILED_TEXT,
} from '@/features/games/game-share';
import { gameKeys } from '@/features/games/queries';
import { copyText } from '@/lib/clipboard';
import { deferred } from '../test-utils/session';

jest.mock('@/api/endpoints');
jest.mock('@/lib/clipboard', () => ({ copyText: jest.fn() }));
jest.mock('expo-router', () => {
  const Screen = jest.fn(() => null);
  const Stack = Object.assign(
    jest.fn(({ children }: { children?: ReactNode }) => children ?? null),
    { Screen },
  );
  return {
    Stack,
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useFocusEffect: jest.fn(),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);
const copy = jest.mocked(copyText);

const user = (username: string): User => ({
  id: `id-${username}`,
  username,
  accountType: 'REGISTERED',
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

const game: Game = {
  id: 'g1',
  date: '2026-11-03T18:30:00.000Z',
  tournament,
  outcomes: [
    { id: 'o1', result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: user('dev-sam') },
    { id: 'o2', result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: user('dev-alex') },
  ],
};

const SHARE: GameShare = {
  shareId: '11111111-1111-4111-8111-111111111111',
  url: 'http://localhost:3100/s/tokenA',
  imageUrl: 'http://localhost:3100/s/tokenA.png',
};
const NEW_SHARE: GameShare = {
  shareId: '22222222-2222-4222-8222-222222222222',
  url: 'http://localhost:3100/s/tokenB',
  imageUrl: 'http://localhost:3100/s/tokenB.png',
};

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function stubNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

let client: QueryClient;
function renderWithClient(ui: ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const shareButton = () => screen.getByRole('button', { name: 'Share result' });
const abortError = () => Object.assign(new Error('Share canceled'), { name: 'AbortError' });

beforeEach(() => {
  jest.clearAllMocks();
  api.getGame.mockReset().mockResolvedValue(game);
  api.issueGameShare.mockReset().mockResolvedValue(SHARE);
  api.revokeGameShare.mockReset().mockResolvedValue(undefined);
  api.getRivalry.mockResolvedValue(null as never);
  copy.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
});

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as Record<string, unknown>).navigator;
  jest.restoreAllMocks();
});

describe('who can share', () => {
  it('offers Share with the public-link disclosure to a participant before anything is issued', async () => {
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    expect(await screen.findByRole('button', { name: 'Share result' })).toBeTruthy();
    expect(screen.getByText(SHARE_DISCLOSURE_TEXT)).toBeTruthy();
    expect(api.issueGameShare).not.toHaveBeenCalled();
    expect(screen.queryByTestId('game-share-url')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke link' })).toBeNull();
  });

  it('hides Share from viewers who did not play in the game', async () => {
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-jordan" />);
    expect(await screen.findByText('Office Babyfoot')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share result' })).toBeNull();
  });
});

describe('native sharing', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'ios');
  });

  it('issues the link for this game and opens the system share sheet with its URL', async () => {
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(api.issueGameShare).toHaveBeenCalledWith('g1');
    await waitFor(() => expect(sheet).toHaveBeenCalledTimes(1));
    const [content] = sheet.mock.calls[0]!;
    expect(content).toEqual(expect.objectContaining({ url: SHARE.url }));
    expect((content as { message: string }).message).toContain(SHARE.url);
    expect(await screen.findByTestId('game-share-url')).toHaveTextContent(SHARE.url);
    expect(copy).not.toHaveBeenCalled();
  });

  it('treats closing the sheet as a normal outcome and keeps the link', async () => {
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));
    await waitFor(() => expect(sheet).toHaveBeenCalledTimes(1));

    expect(await screen.findByTestId('game-share-url')).toHaveTextContent(SHARE.url);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeTruthy();
    expect(api.revokeGameShare).not.toHaveBeenCalled();

    // Sharing again confirms the link with the server, which returns the same active one.
    await fireEvent.press(shareButton());
    await waitFor(() => expect(sheet).toHaveBeenCalledTimes(2));
    expect(api.issueGameShare).toHaveBeenCalledTimes(2);
    expect(sheet.mock.calls[1]![0]).toEqual(expect.objectContaining({ url: SHARE.url }));
  });

  it('shows the selectable link when the share sheet fails', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('no activity'));
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(await screen.findByText(SHARE_SHEET_FAILED_TEXT)).toBeTruthy();
    const link = screen.getByTestId('game-share-url');
    expect(link).toHaveTextContent(SHARE.url);
    expect(link.props.selectable).toBe(true);
    expect(screen.queryByText(COPIED_TEXT)).toBeNull();
  });

  it('reports a refused issue without opening the sheet', async () => {
    const sheet = jest.spyOn(Share, 'share');
    api.issueGameShare.mockRejectedValue(
      new ApiError(403, 'NOT_GAME_PARTICIPANT', 'Only players of this game can share it'),
    );
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(
      await screen.findByText("Couldn't create the link: Only players of this game can share it"),
    ).toBeTruthy();
    expect(sheet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('game-share-url')).toBeNull();
  });
});

describe('web sharing', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
  });

  it('copies the issued URL when navigator.share is missing and confirms only after the copy', async () => {
    stubNavigator({});
    const copying = deferred<boolean>();
    copy.mockReturnValue(copying.promise);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    await waitFor(() => expect(copy).toHaveBeenCalledWith(SHARE.url));
    expect(screen.queryByText(COPIED_TEXT)).toBeNull();
    copying.resolve(true);
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();
    expect(screen.getByTestId('game-share-url')).toHaveTextContent(SHARE.url);
  });

  it('offers the selectable link without claiming success when copying fails', async () => {
    stubNavigator({});
    copy.mockResolvedValue(false);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(await screen.findByText(COPY_FAILED_TEXT)).toBeTruthy();
    expect(screen.queryByText(COPIED_TEXT)).toBeNull();
    const link = screen.getByTestId('game-share-url');
    expect(link).toHaveTextContent(SHARE.url);
    expect(link.props.selectable).toBe(true);
  });

  it('hands the URL to navigator.share when the browser has it', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toEqual(expect.objectContaining({ url: SHARE.url }));
    expect(copy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat a cancelled browser share as an error', async () => {
    const share = jest.fn().mockRejectedValue(abortError());
    stubNavigator({ share });
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(await screen.findByTestId('game-share-url')).toHaveTextContent(SHARE.url);
    expect(share).toHaveBeenCalledTimes(1);
    expect(copy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.revokeGameShare).not.toHaveBeenCalled();
  });

  it('falls back to copying when the browser refuses to share', async () => {
    const share = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    stubNavigator({ share });
    copy.mockResolvedValue(true);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();
    expect(copy).toHaveBeenCalledWith(SHARE.url);
  });

  it('copies the link again from the Copy link button with honest feedback', async () => {
    stubNavigator({});
    copy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText(COPY_FAILED_TEXT)).toBeTruthy();
    expect(screen.queryByText(COPIED_TEXT)).toBeNull();
    expect(copy).toHaveBeenLastCalledWith(SHARE.url);
  });
});

describe('revoking my link', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    stubNavigator({});
    copy.mockResolvedValue(true);
  });

  it('revokes the issued link after confirmation, and a later share issues a new one', async () => {
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));
    expect(await screen.findByTestId('game-share-url')).toHaveTextContent(SHARE.url);

    await fireEvent.press(screen.getByRole('button', { name: 'Revoke link' }));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(api.revokeGameShare).not.toHaveBeenCalled();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Revoke link' }).at(-1)!);

    await waitFor(() => expect(api.revokeGameShare).toHaveBeenCalledWith('g1', SHARE.shareId));
    expect(await screen.findByText(SHARE_REVOKED_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('game-share-url')).toBeNull();
    expect(client.getQueryData(gameKeys.share('g1'))).toBeNull();

    api.issueGameShare.mockResolvedValue(NEW_SHARE);
    await fireEvent.press(shareButton());
    expect(await screen.findByTestId('game-share-url')).toHaveTextContent(NEW_SHARE.url);
    expect(api.issueGameShare).toHaveBeenCalledTimes(2);
    expect(copy).toHaveBeenLastCalledWith(NEW_SHARE.url);
  });

  it('keeps the link and explains when revoking fails', async () => {
    api.revokeGameShare.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Network down'));
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));
    await screen.findByTestId('game-share-url');

    await fireEvent.press(screen.getByRole('button', { name: 'Revoke link' }));
    await fireEvent.press(screen.getAllByRole('button', { name: 'Revoke link' }).at(-1)!);

    expect(await screen.findByText("Couldn't revoke the link: Network down")).toBeTruthy();
    expect(screen.getByTestId('game-share-url')).toHaveTextContent(SHARE.url);
    expect(screen.queryByText(SHARE_REVOKED_TEXT)).toBeNull();
  });
});

describe('a link revoked in another session', () => {
  // This session issued SHARE earlier; the same account revoked it elsewhere, so the server's
  // create-or-reuse endpoint now issues NEW_SHARE.
  beforeEach(() => {
    client.setQueryData(gameKeys.share('g1'), SHARE);
    api.issueGameShare.mockResolvedValue(NEW_SHARE);
  });

  it('shares the replacement link, never the revoked one', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    stubNavigator({});
    copy.mockResolvedValue(true);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    expect(await screen.findByTestId('game-share-url')).toHaveTextContent(SHARE.url);

    await fireEvent.press(shareButton());
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();
    expect(api.issueGameShare).toHaveBeenCalledWith('g1');
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(NEW_SHARE.url);
    expect(screen.getByTestId('game-share-url')).toHaveTextContent(NEW_SHARE.url);
    expect(client.getQueryData(gameKeys.share('g1'))).toEqual(NEW_SHARE);
  });

  it('opens the native share sheet with the replacement link', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    await waitFor(() => expect(sheet).toHaveBeenCalledTimes(1));
    expect(sheet.mock.calls[0]![0]).toEqual(expect.objectContaining({ url: NEW_SHARE.url }));
    expect(await screen.findByTestId('game-share-url')).toHaveTextContent(NEW_SHARE.url);
  });

  it('copies the replacement link from Copy link', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    stubNavigator({});
    copy.mockResolvedValue(true);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Copy link' }));

    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();
    expect(api.issueGameShare).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(NEW_SHARE.url);
    expect(screen.getByTestId('game-share-url')).toHaveTextContent(NEW_SHARE.url);
  });

  it('does not hand out the cached link when it cannot be confirmed', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const share = jest.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    api.issueGameShare.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Network down'));
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(await screen.findByText("Couldn't create the link: Network down")).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(api.issueGameShare).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Couldn't create the link: Network down")).toBeTruthy();
    expect(copy).not.toHaveBeenCalled();
  });

  it('disables the actions while the link is being confirmed', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    stubNavigator({});
    copy.mockResolvedValue(true);
    const issuing = deferred<GameShare>();
    api.issueGameShare.mockReturnValue(issuing.promise);
    await renderWithClient(<GameDetailScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share result' }));

    expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Copy link' }));
    expect(api.issueGameShare).toHaveBeenCalledTimes(1);

    issuing.resolve(NEW_SHARE);
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(NEW_SHARE.url);
  });
});

describe('post-record result screen', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    stubNavigator({});
    copy.mockResolvedValue(true);
  });

  it('shares the just-saved game, and its durable detail shows the same link', async () => {
    client.setQueryData(gameKeys.detail('g1'), game);
    const view = await renderWithClient(<GameResultScreen id="g1" viewer="dev-alex" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share result' }));

    await waitFor(() => expect(copy).toHaveBeenCalledWith(SHARE.url));
    expect(api.issueGameShare).toHaveBeenCalledWith('g1');
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy();

    await view.rerender(
      <QueryClientProvider client={client}>
        <GameDetailScreen id="g1" viewer="dev-alex" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('game-share-url')).toHaveTextContent(SHARE.url);
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeTruthy();
    await fireEvent.press(shareButton());
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(2));
    expect(copy).toHaveBeenLastCalledWith(SHARE.url);
    expect(api.issueGameShare).toHaveBeenCalledTimes(2);
  });
});
