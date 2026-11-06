import { activateKeepAwakeAsync, deactivateKeepAwake, isAvailableAsync } from 'expo-keep-awake';
import { useEffect } from 'react';

const TAG = 'sharkulator-qr-code';

/**
 * Keeps the screen on while mounted, so a QR code stays visible while someone lines up a scan.
 * Browsers without the Wake Lock API just skip it.
 */
export function StayAwake() {
  useEffect(() => {
    let live = true;
    let active = false;
    void (async () => {
      try {
        if (!(await isAvailableAsync()) || !live) return;
        await activateKeepAwakeAsync(TAG);
        active = true;
        if (!live) await deactivateKeepAwake(TAG);
      } catch {
        // A refused wake lock only means the screen may dim; the code is still shown.
      }
    })();
    return () => {
      live = false;
      if (active) void deactivateKeepAwake(TAG).catch(() => undefined);
    };
  }, []);
  return null;
}
