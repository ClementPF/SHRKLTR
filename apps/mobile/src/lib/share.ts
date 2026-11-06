import { Platform, Share } from 'react-native';

export type ShareOutcome = 'shared' | 'dismissed';

interface WebShareNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

function webNavigator(): WebShareNavigator | undefined {
  return (globalThis as { navigator?: WebShareNavigator }).navigator;
}

/** Native always has a share sheet; on the web only browsers with navigator.share do. */
export function canShareLinks(os: string = Platform.OS): boolean {
  return os !== 'web' || typeof webNavigator()?.share === 'function';
}

/**
 * Opens the system share sheet for a link. Closing the sheet is not an error. Callers should
 * check `canShareLinks()` first and offer copying instead where sharing is unavailable.
 */
export async function shareLink(
  { url, message, title }: { url: string; message: string; title?: string },
  os: string = Platform.OS,
): Promise<ShareOutcome> {
  if (os === 'web') {
    const share = webNavigator()?.share;
    if (typeof share !== 'function') throw new Error('Sharing is not available in this browser.');
    try {
      await share.call(webNavigator(), { title, text: message, url });
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'dismissed';
      throw err;
    }
  }
  // Android ignores `url`, so the link also goes in the message.
  const result = await Share.share(
    { title, message: `${message} ${url}`, url },
    { subject: title },
  );
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
