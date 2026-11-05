import {
  INBOX_HREF,
  notificationTargetHref,
  parseNotificationTarget,
} from '@/notifications/targets';
import {
  createNotificationTapRouter,
  DEFAULT_ACTION,
  type TapResponse,
} from '@/notifications/tap-router';

const GAME_ID = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_ID = '22222222-2222-4222-8222-222222222222';
const NOTIFICATION_ID = '33333333-3333-4333-8333-333333333333';

function tap(
  identifier: string,
  data: unknown,
  actionIdentifier: string = DEFAULT_ACTION,
): TapResponse {
  return { actionIdentifier, notification: { request: { identifier, content: { data } } } };
}

function setup() {
  const navigate = jest.fn();
  const markRead = jest.fn();
  return { navigate, markRead, router: createNotificationTapRouter({ navigate, markRead }) };
}

describe('notification target mapper', () => {
  it('maps game, achievements and user targets to their screens', () => {
    expect(notificationTargetHref({ type: 'game', gameId: GAME_ID })).toEqual({
      pathname: '/games/[id]',
      params: { id: GAME_ID },
    });
    expect(notificationTargetHref({ type: 'achievements', username: 'dev-sam' })).toEqual({
      pathname: '/achievements/[username]',
      params: { username: 'dev-sam' },
    });
    expect(notificationTargetHref({ type: 'user', username: 'guest-riley' })).toEqual({
      pathname: '/user/[username]',
      params: { username: 'guest-riley' },
    });
    expect(notificationTargetHref({ type: 'challenge', challengeId: CHALLENGE_ID })).toBeNull();
  });

  it.each([
    ['a URL string', 'https://evil.example/phish'],
    ['an unknown type', { type: 'url', url: 'https://evil.example' }],
    ['a game without a UUID', { type: 'game', gameId: '../../settings' }],
    ['a user with a path', { type: 'user', username: 'dev-sam/../../login' }],
    ['a user with a scheme', { type: 'achievements', username: 'javascript:alert(1)' }],
    ['null', null],
    ['an array', [{ type: 'game', gameId: GAME_ID }]],
  ])('rejects %s', (_, value) => {
    expect(parseNotificationTarget(value)).toBeNull();
  });

  it('keeps only the typed fields of a valid target', () => {
    expect(
      parseNotificationTarget({ type: 'game', gameId: GAME_ID, url: 'https://evil.example' }),
    ).toEqual({ type: 'game', gameId: GAME_ID });
  });
});

describe('notification tap router', () => {
  it('opens game, achievements and user targets and marks the notification read', () => {
    const { router, navigate, markRead } = setup();
    router.setReady(true);

    router.handle(
      tap('a', { notificationId: NOTIFICATION_ID, target: { type: 'game', gameId: GAME_ID } }),
    );
    router.handle(tap('b', { target: { type: 'achievements', username: 'dev-sam' } }));
    router.handle(tap('c', { target: { type: 'user', username: 'guest-riley' } }));

    expect(navigate.mock.calls).toEqual([
      [{ pathname: '/games/[id]', params: { id: GAME_ID } }],
      [{ pathname: '/achievements/[username]', params: { username: 'dev-sam' } }],
      [{ pathname: '/user/[username]', params: { username: 'guest-riley' } }],
    ]);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(NOTIFICATION_ID);
  });

  it('holds a cold-start tap until auth and navigation are ready, then navigates once', () => {
    const { router, navigate, markRead } = setup();

    router.handle(
      tap('launch', { notificationId: NOTIFICATION_ID, target: { type: 'game', gameId: GAME_ID } }),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();

    router.setReady(false);
    expect(navigate).not.toHaveBeenCalled();

    router.setReady(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(NOTIFICATION_ID);

    router.setReady(false);
    router.setReady(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated response ID (listener plus last-response at launch)', () => {
    const { router, navigate } = setup();
    router.setReady(true);
    const response = tap('same', { target: { type: 'game', gameId: GAME_ID } });

    router.handle(response);
    router.handle(response);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('opens the latest of several taps received before ready', () => {
    const { router, navigate } = setup();
    router.handle(tap('1', { target: { type: 'game', gameId: GAME_ID } }));
    router.handle(tap('2', { target: { type: 'user', username: 'dev-sam' } }));
    router.setReady(true);
    expect(navigate.mock.calls).toEqual([
      [{ pathname: '/user/[username]', params: { username: 'dev-sam' } }],
    ]);
  });

  it('never navigates for invalid targets or arbitrary URLs', () => {
    const { router, navigate, markRead } = setup();
    router.setReady(true);

    router.handle(tap('x1', { target: 'https://evil.example' }));
    router.handle(tap('x2', { url: '/settings/invite', target: { type: 'url', url: '/login' } }));
    router.handle(tap('x3', { target: { type: 'game', gameId: 'not-a-uuid' } }));
    router.handle(tap('x4', undefined));

    expect(navigate).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
  });

  it('opens the inbox for a valid target that has no screen of its own', () => {
    const { router, navigate } = setup();
    router.setReady(true);
    router.handle(tap('c', { target: { type: 'challenge', challengeId: CHALLENGE_ID } }));
    expect(navigate).toHaveBeenCalledWith(INBOX_HREF);
  });

  it('ignores actions other than tapping the notification', () => {
    const { router, navigate } = setup();
    router.setReady(true);
    router.handle(tap('d', { target: { type: 'game', gameId: GAME_ID } }, 'dismiss'));
    expect(navigate).not.toHaveBeenCalled();
  });
});
