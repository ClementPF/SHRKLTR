import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

/**
 * Copies text and reports whether it really landed on the clipboard. On web the browser may
 * refuse (no focus, no permission), in which case callers must not claim success.
 */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS === 'web') return copyTextOnWeb(text);
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}

// expo-clipboard's web fallback reports success even when `execCommand('copy')` returns false,
// so the web path is implemented here to surface the browser's real answer.
async function copyTextOnWeb(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unfocused: try the legacy selection copy below.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
  }
}
