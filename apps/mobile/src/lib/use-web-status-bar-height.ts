import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

function measureTopInset(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px)';
  document.body.appendChild(probe);
  const top = Number.parseFloat(getComputedStyle(probe).paddingTop) || 0;
  document.body.removeChild(probe);
  return top;
}

/**
 * Height of the status bar the web app draws under when installed to the home screen. Expo
 * Router reports zero insets on web, so headers would otherwise sit under the clock; CSS env()
 * is the only source of the real inset there. Undefined on native, where headers measure it.
 */
export function useWebStatusBarHeight(): number | undefined {
  const web = Platform.OS === 'web';
  const [top, setTop] = useState(() => (web ? measureTopInset() : undefined));
  useEffect(() => {
    if (!web) return;
    const update = () => setTop(measureTopInset());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [web]);
  return top;
}
