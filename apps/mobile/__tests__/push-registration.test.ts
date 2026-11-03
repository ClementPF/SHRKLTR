import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken } from '@/api/endpoints';
import { registerForPushNotifications } from '@/notifications/push-registration';
import { registerForPushNotifications as registerOnWeb } from '@/notifications/push-registration.web';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { easConfig: { projectId: 'project-123' }, expoConfig: null },
}));

jest.mock('@/api/endpoints', () => ({ registerPushToken: jest.fn(async () => undefined) }));

const mocked = Notifications as jest.Mocked<typeof Notifications>;
const permission = (status: string) =>
  ({ status }) as unknown as Notifications.NotificationPermissionsStatus;

describe('push registration', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getExpoPushTokenAsync.mockResolvedValue({
      type: 'expo',
      data: 'ExponentPushToken[abc]',
    });
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('on native: requests permission, gets the Expo token and POSTs it', async () => {
    Platform.OS = 'ios';
    mocked.getPermissionsAsync.mockResolvedValue(permission('undetermined'));
    mocked.requestPermissionsAsync.mockResolvedValue(permission('granted'));

    await expect(registerForPushNotifications()).resolves.toBe('ExponentPushToken[abc]');

    expect(mocked.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-123' });
    expect(registerPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]');
  });

  it('on native: does nothing when permission is denied', async () => {
    Platform.OS = 'ios';
    mocked.getPermissionsAsync.mockResolvedValue(permission('undetermined'));
    mocked.requestPermissionsAsync.mockResolvedValue(permission('denied'));

    await expect(registerForPushNotifications()).resolves.toBeNull();

    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it('on android: sets up the default channel before registering', async () => {
    Platform.OS = 'android';
    mocked.getPermissionsAsync.mockResolvedValue(permission('granted'));

    await registerForPushNotifications();

    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.anything());
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(registerPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]');
  });

  it('on web: skips registration entirely', async () => {
    Platform.OS = 'web';

    await expect(registerForPushNotifications()).resolves.toBeNull();
    await expect(registerOnWeb()).resolves.toBeNull();

    expect(mocked.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registerPushToken).not.toHaveBeenCalled();
  });
});
