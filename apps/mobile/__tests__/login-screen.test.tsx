import { fireEvent, render, screen } from '@testing-library/react-native';

import type { GoogleSignIn } from '@/auth/google';
import { useGoogleSignIn } from '@/auth/google';
import { useSession } from '@/auth/session';
import { LoginScreen } from '@/features/auth/login-screen';

jest.mock('@/auth/google', () => ({ useGoogleSignIn: jest.fn() }));
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));

const mockedGoogle = jest.mocked(useGoogleSignIn);
const mockedSession = jest.mocked(useSession);

function google(overrides: Partial<GoogleSignIn> = {}): GoogleSignIn {
  return {
    ready: true,
    configured: true,
    status: 'idle',
    error: null,
    signIn: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('LoginScreen', () => {
  const loginWithDevUser = jest.fn(async () => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSession.mockReturnValue({
      status: 'unauthenticated',
      session: null,
      user: null,
      loginWithGoogleCode: jest.fn(async () => undefined),
      loginWithDevUser,
      logout: jest.fn(async () => undefined),
      refresh: jest.fn(async () => false),
    });
  });

  it('renders branding and the Google button, and starts the Google flow on press', async () => {
    const state = google();
    mockedGoogle.mockReturnValue(state);

    await render(<LoginScreen devSignInEnabled={false} />);

    expect(screen.getByText('SHARKULATOR')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(state.signIn).toHaveBeenCalledTimes(1);
  });

  it('hides the dev sign-in control when dev sessions are disabled', async () => {
    mockedGoogle.mockReturnValue(google());
    await render(<LoginScreen devSignInEnabled={false} />);
    expect(screen.queryByText('DEV SIGN-IN')).toBeNull();
  });

  it('lists seeded users and signs in through the dev session', async () => {
    mockedGoogle.mockReturnValue(google());
    await render(<LoginScreen devSignInEnabled />);

    expect(screen.getByText('DEV SIGN-IN')).toBeTruthy();
    await fireEvent.press(screen.getByText('dev-sam'));
    await fireEvent.press(screen.getByRole('button', { name: 'Dev sign in' }));

    expect(loginWithDevUser).toHaveBeenCalledWith('dev-sam');
  });

  it('shows a loading state while Google sign-in is pending', async () => {
    mockedGoogle.mockReturnValue(google({ status: 'pending' }));
    await render(<LoginScreen devSignInEnabled={false} />);
    expect(screen.getByText('Signing in…')).toBeTruthy();
  });

  it('shows the error with a retry action', async () => {
    const state = google({ status: 'error', error: 'Google sign-in failed.' });
    mockedGoogle.mockReturnValue(state);
    await render(<LoginScreen devSignInEnabled={false} />);

    expect(screen.getByText('Google sign-in failed.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(state.signIn).toHaveBeenCalledTimes(1);
  });
});
