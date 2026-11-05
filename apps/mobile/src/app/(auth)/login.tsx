import { useLocalSearchParams } from 'expo-router';

import { LoginScreen, ORDINARY_SIGN_IN_MODE } from '@/features/auth/login-screen';

export default function LoginRoute() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return <LoginScreen ordinarySignIn={mode === ORDINARY_SIGN_IN_MODE} />;
}
