import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import ScannerRoute from '@/app/(app)/game-form/scanner';

jest.mock('@/auth/session', () => ({ useSession: () => ({ user: { username: 'sam' } }) }));
jest.mock('@/features/game-form/scanner-screen', () => ({ ScannerScreen: () => null }));
jest.mock('expo-router', () => ({
  Stack: { Screen: ({ options }: { options: { header(): ReactNode } }) => options.header() },
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };

describe('Lost screen header', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(router.canGoBack).mockReturnValue(true);
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
  });

  it('places the header below the iPhone status bar and goes back to Add Game', async () => {
    await render(<ScannerRoute />);
    expect(screen.getByTestId('scanner-header')).toHaveStyle({ paddingTop: 59 });
    expect(screen.getByText('Scan the QR code')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('updates safe-area spacing after rotation', async () => {
    const view = await render(<ScannerRoute />);
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    await view.rerender(<ScannerRoute />);
    expect(screen.getByTestId('scanner-header')).toHaveStyle({
      paddingTop: 0,
      paddingLeft: 59,
      paddingRight: 59,
    });
  });

  it('returns to Add Game when opened without navigation history', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(false);
    await render(<ScannerRoute />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(router.replace).toHaveBeenCalledWith('/(app)/(tabs)/add-game');
    expect(router.back).not.toHaveBeenCalled();
  });
});
