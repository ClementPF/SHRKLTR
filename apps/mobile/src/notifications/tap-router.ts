import type { Href } from 'expo-router';

import { notificationIdFrom, notificationTargetHref, targetFromData } from './targets';

/** expo-notifications' DEFAULT_ACTION_IDENTIFIER: the user tapped the notification itself. */
export const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/** The parts of an expo-notifications NotificationResponse the router reads. */
export interface TapResponse {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: { data?: unknown } } };
}

export interface TapRouterDeps {
  navigate(href: Href): void;
  markRead(notificationId: string): void;
}

export interface NotificationTapRouter {
  /** Records a tap; it is acted on once the app is ready. Repeated response IDs are ignored. */
  handle(response: TapResponse): void;
  /** Ready = session hydrated and signed in, with the navigator mounted. */
  setReady(ready: boolean): void;
}

/**
 * Turns notification taps into navigation. Taps that arrive before the app can navigate
 * (cold start, auth hydration, signed out) are held and the latest one is opened when ready.
 */
export function createNotificationTapRouter(deps: TapRouterDeps): NotificationTapRouter {
  const seen = new Set<string>();
  let ready = false;
  let pending: { href: Href | null; notificationId: string | null } | null = null;

  const flush = () => {
    if (!ready || !pending) return;
    const { href, notificationId } = pending;
    pending = null;
    if (notificationId) deps.markRead(notificationId);
    if (href) deps.navigate(href);
  };

  return {
    handle(response) {
      if (response.actionIdentifier !== DEFAULT_ACTION) return;
      const { identifier, content } = response.notification.request;
      if (seen.has(identifier)) return;
      seen.add(identifier);

      const data = content.data;
      const notificationId = notificationIdFrom(data);
      const target = targetFromData(data);
      const href = target ? notificationTargetHref(target) : null;
      if (!href && !notificationId) return;
      pending = { href, notificationId };
      flush();
    },
    setReady(next) {
      ready = next;
      flush();
    },
  };
}
