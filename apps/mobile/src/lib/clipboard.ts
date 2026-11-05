import * as Clipboard from 'expo-clipboard';

/**
 * Copies text and reports whether it really landed on the clipboard. On web the browser may
 * refuse (no focus, no permission), in which case callers must not claim success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}
