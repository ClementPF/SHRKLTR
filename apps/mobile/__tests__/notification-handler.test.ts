import { createNotificationReceivedHandler } from '@/notifications/notification-handler';

describe('notification received handler', () => {
  it('invalidates every cached query so screens refetch', () => {
    const queryClient = { invalidateQueries: jest.fn(async () => undefined) };
    const handler = createNotificationReceivedHandler(queryClient);

    handler();
    handler();

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith();
  });
});
