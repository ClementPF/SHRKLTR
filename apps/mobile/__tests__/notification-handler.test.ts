import {
  createNotificationReceivedHandler,
  queryKeysForTarget,
} from '@/notifications/notification-handler';

const GAME_ID = '11111111-1111-4111-8111-111111111111';

const received = (data: unknown) => ({ request: { content: { data } } });

describe('foreground notification handler', () => {
  it('refreshes the inbox and the game-related data of a game notification', () => {
    const queryClient = { invalidateQueries: jest.fn(async () => undefined) };
    const handler = createNotificationReceivedHandler(queryClient);

    handler(received({ notificationId: GAME_ID, target: { type: 'game', gameId: GAME_ID } }));

    const calls = queryClient.invalidateQueries.mock.calls as unknown as [{ queryKey: unknown }][];
    const keys = calls.map(([arg]) => arg.queryKey);
    expect(keys).toEqual([
      ['notifications'],
      ...queryKeysForTarget({ type: 'game', gameId: GAME_ID }),
    ]);
    expect(keys).toContainEqual(['games', 'detail', GAME_ID]);
    expect(keys).toContainEqual(['users']);
  });

  it('only refreshes the inbox when the payload has no valid target', () => {
    const queryClient = { invalidateQueries: jest.fn(async () => undefined) };
    const handler = createNotificationReceivedHandler(queryClient);

    handler(received({ target: { type: 'url', url: 'https://evil.example' } }));
    handler(received(undefined));

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  it('maps achievement and user targets to their caches', () => {
    expect(queryKeysForTarget({ type: 'achievements', username: 'dev-sam' })).toEqual([
      ['achievements'],
    ]);
    expect(queryKeysForTarget({ type: 'user', username: 'guest-riley' })).toContainEqual([
      'invited-players',
    ]);
  });
});
