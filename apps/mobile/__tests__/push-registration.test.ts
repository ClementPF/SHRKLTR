import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushDevice, unregisterPushDevice } from '@/api/endpoints';
import { INSTALLATION_ID_KEY, setInstallationIdStorage } from '@/notifications/installation-id';
import {
  registerForPushNotifications,
  unregisterPushNotifications,
  watchPushTokenChanges,
} from '@/notifications/push-registration';
import * as webRegistration from '@/notifications/push-registration.web';

import { deferred, memoryStorage } from '../test-utils/session';

async function flushMicrotasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function waitForCall(fn: { mock: { calls: unknown[] } }) {
  for (let i = 0; i < 50 && fn.mock.calls.length === 0; i += 1) await Promise.resolve();
  expect(fn).toHaveBeenCalled();
}

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addPushTokenListener: jest.fn(),
}));

const mockConstants: { easConfig: { projectId?: string } | null } = {
  easConfig: { projectId: 'project-123' },
};
// Read lazily: the factory is hoisted above the declaration.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get easConfig() {
      return mockConstants.easConfig;
    },
    expoConfig: null,
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@/api/endpoints', () => ({
  registerPushDevice: jest.fn(async () => undefined),
  unregisterPushDevice: jest.fn(async () => undefined),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;
const permission = (status: string) =>
  ({ status }) as unknown as Notifications.NotificationPermissionsStatus;

describe('push registration', () => {
  const originalOS = Platform.OS;
  let store: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = memoryStorage();
    setInstallationIdStorage(store.storage);
    mockConstants.easConfig = { projectId: 'project-123' };
    mocked.getExpoPushTokenAsync.mockResolvedValue({
      type: 'expo',
      data: 'ExponentPushToken[abc]',
    });
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  afterAll(() => setInstallationIdStorage(null));

  it('on native: requests permission and registers the token for this installation', async () => {
    Platform.OS = 'ios';
    mocked.getPermissionsAsync.mockResolvedValue(permission('undetermined'));
    mocked.requestPermissionsAsync.mockResolvedValue(permission('granted'));

    await expect(registerForPushNotifications()).resolves.toBe('ExponentPushToken[abc]');

    expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-123' });
    const installationId = store.data.get(INSTALLATION_ID_KEY);
    expect(installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(registerPushDevice).toHaveBeenCalledWith({
      installationId,
      expoToken: 'ExponentPushToken[abc]',
      platform: 'IOS',
    });
  });

  it('keeps the installation ID across launches and sends the current (rotated) token', async () => {
    Platform.OS = 'android';
    mocked.getPermissionsAsync.mockResolvedValue(permission('granted'));
    await registerForPushNotifications();
    const first = jest.mocked(registerPushDevice).mock.calls[0]![0];

    // A new launch: in-memory cache gone, storage kept, token rotated.
    setInstallationIdStorage(store.storage);
    mocked.getExpoPushTokenAsync.mockResolvedValue({
      type: 'expo',
      data: 'ExponentPushToken[new]',
    });
    await registerForPushNotifications();
    const second = jest.mocked(registerPushDevice).mock.calls[1]![0];

    expect(second.installationId).toBe(first.installationId);
    expect(second).toEqual({
      installationId: first.installationId,
      expoToken: 'ExponentPushToken[new]',
      platform: 'ANDROID',
    });
    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.anything());
  });

  it('on native: does nothing when permission is denied', async () => {
    Platform.OS = 'ios';
    mocked.getPermissionsAsync.mockResolvedValue(permission('undetermined'));
    mocked.requestPermissionsAsync.mockResolvedValue(permission('denied'));

    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('on native: skips push quietly when no EAS project ID is configured', async () => {
    Platform.OS = 'ios';
    mockConstants.easConfig = null;
    mocked.getPermissionsAsync.mockResolvedValue(permission('granted'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registerPushDevice).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unregisters only this installation', async () => {
    Platform.OS = 'ios';
    store.data.set(INSTALLATION_ID_KEY, 'install-1');
    setInstallationIdStorage(store.storage);

    await unregisterPushNotifications();
    expect(unregisterPushDevice).toHaveBeenCalledWith('install-1');
  });

  it('skips unregistering when this installation never registered', async () => {
    Platform.OS = 'ios';
    await unregisterPushNotifications();
    expect(unregisterPushDevice).not.toHaveBeenCalled();
  });

  it('passes the rotated device token to the watcher', () => {
    Platform.OS = 'ios';
    const remove = jest.fn();
    mocked.addPushTokenListener.mockReturnValue({ remove });
    const onChange = jest.fn();

    const stop = watchPushTokenChanges(onChange);
    mocked.addPushTokenListener.mock.calls[0]![0]({ type: 'ios', data: 'device-token' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ type: 'ios', data: 'device-token' });
    stop();
    expect(remove).toHaveBeenCalled();
  });

  it('exchanges a rotated device token without asking the OS again (no listener loop)', async () => {
    Platform.OS = 'ios';
    mocked.getPermissionsAsync.mockResolvedValue(permission('granted'));
    let listener: ((token: Notifications.DevicePushToken) => void) | null = null;
    mocked.addPushTokenListener.mockImplementation((l) => {
      listener = l;
      return { remove: jest.fn() };
    });
    const registrations: Promise<unknown>[] = [];
    watchPushTokenChanges((token) => {
      registrations.push(registerForPushNotifications({ devicePushToken: token }));
    });
    // Mirrors the SDK: without a supplied device token, getExpoPushTokenAsync asks the OS for one,
    // and on iOS that registration completes by firing the token listener again (capped here).
    let reacquired = 0;
    mocked.getExpoPushTokenAsync.mockImplementation(async (options) => {
      if (!options?.devicePushToken && reacquired < 5) {
        reacquired += 1;
        listener!({ type: 'ios', data: 'device-token' });
      }
      return { type: 'expo', data: 'ExponentPushToken[rotated]' };
    });

    listener!({ type: 'ios', data: 'rotated-device-token' });
    for (let settled = 0; settled < registrations.length;) {
      settled = registrations.length;
      await Promise.all(registrations);
    }

    expect(reacquired).toBe(0);
    expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
    expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'project-123',
      devicePushToken: { type: 'ios', data: 'rotated-device-token' },
    });
    expect(registerPushDevice).toHaveBeenCalledTimes(1);
    expect(registerPushDevice).toHaveBeenCalledWith(
      expect.objectContaining({ expoToken: 'ExponentPushToken[rotated]' }),
    );
  });

  it('stops without registering when cancelled while the token is being fetched', async () => {
    Platform.OS = 'ios';
    mocked.getPermissionsAsync.mockResolvedValue(permission('granted'));
    const token = deferred<Notifications.ExpoPushToken>();
    mocked.getExpoPushTokenAsync.mockReturnValue(token.promise);
    const controller = new AbortController();

    let settled = false;
    const pending = registerForPushNotifications({ signal: controller.signal }).finally(() => {
      settled = true;
    });
    await waitForCall(mocked.getExpoPushTokenAsync);
    controller.abort();
    await flushMicrotasks();
    // Settles right away, without waiting for the token that may never come.
    expect(settled).toBe(true);
    await expect(pending).resolves.toBeNull();

    token.resolve({ type: 'expo', data: 'ExponentPushToken[late]' });
    await flushMicrotasks();
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('does not start a registration that was cancelled before it began', async () => {
    Platform.OS = 'ios';
    mocked.getPermissionsAsync.mockResolvedValue(permission('granted'));
    const controller = new AbortController();
    controller.abort();

    await expect(registerForPushNotifications({ signal: controller.signal })).resolves.toBeNull();
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('on web: registration, unregistration and token watching are no-ops', async () => {
    Platform.OS = 'web';

    await expect(registerForPushNotifications()).resolves.toBeNull();
    await expect(unregisterPushNotifications()).resolves.toBeUndefined();
    await expect(webRegistration.registerForPushNotifications()).resolves.toBeNull();
    await expect(webRegistration.unregisterPushNotifications()).resolves.toBeUndefined();
    webRegistration.watchPushTokenChanges()();

    expect(mocked.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mocked.addPushTokenListener).not.toHaveBeenCalled();
    expect(registerPushDevice).not.toHaveBeenCalled();
    expect(unregisterPushDevice).not.toHaveBeenCalled();
  });
});
