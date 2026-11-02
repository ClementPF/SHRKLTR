import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { useGoogleSignIn } from '@/auth/google';
import { DEV_USERNAMES, isDevSessionEnabled } from '@/auth/devSession';
import { useSession } from '@/auth/session';
import { versionLabel } from '@/lib/app-info';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

import appIcon from '../../../assets/images/icon.png';

const WELCOME_TEXT =
  'Welcome to the SHARKULATOR fellow shark, before starting preying on some fishes please sign in.';

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      <Button title="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

function DevSignIn() {
  const { loginWithDevUser } = useSession();
  const [username, setUsername] = useState(DEV_USERNAMES[0] ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const name = username.trim();
    if (!name) return;
    setError(null);
    setPending(true);
    try {
      await loginWithDevUser(name);
    } catch (err) {
      setError(messageOf(err, 'Dev sign-in failed.'));
      setPending(false);
    }
  }, [loginWithDevUser, username]);

  return (
    <View style={styles.dev} testID="dev-sign-in">
      <Text style={styles.devTitle}>DEV SIGN-IN</Text>
      <TextInput
        accessibilityLabel="Dev username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="seeded username"
        placeholderTextColor={Colors.textMuted}
        onSubmitEditing={() => void submit()}
      />
      <View style={styles.chips}>
        {DEV_USERNAMES.map((name) => (
          <Text
            key={name}
            accessibilityRole="button"
            onPress={() => setUsername(name)}
            style={[styles.chip, name === username && styles.chipSelected]}
          >
            {name}
          </Text>
        ))}
      </View>
      <Button
        title="Dev sign in"
        variant="secondary"
        loading={pending}
        disabled={!username.trim()}
        onPress={() => void submit()}
      />
      {error && <ErrorBanner message={error} onRetry={() => void submit()} />}
    </View>
  );
}

export interface LoginScreenProps {
  devSignInEnabled?: boolean;
}

export function LoginScreen({ devSignInEnabled = isDevSessionEnabled() }: LoginScreenProps) {
  const { login } = useSession();
  const google = useGoogleSignIn(login);

  return (
    <ScrollView style={Palette.screen} contentContainerStyle={styles.container}>
      <View style={styles.brand}>
        <Image source={appIcon} style={styles.logo} accessibilityLabel="Sharkulator logo" />
        <Text style={styles.title}>SHARKULATOR</Text>
        <Text style={styles.welcome}>{WELCOME_TEXT}</Text>
      </View>

      <View style={styles.actions}>
        <Button
          title={google.status === 'pending' ? 'Signing in…' : 'Continue with Google'}
          loading={google.status === 'pending'}
          disabled={!google.ready}
          onPress={() => void google.signIn()}
        />
        {!google.configured && (
          <Text style={Typography.caption}>Google sign-in is not configured for this build.</Text>
        )}
        {google.status === 'error' && google.error && (
          <ErrorBanner message={google.error} onRetry={() => void google.signIn()} />
        )}
      </View>

      {devSignInEnabled && <DevSignIn />}

      <Text style={styles.version}>{versionLabel()}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: Spacing.lg,
    gap: Spacing.lg,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  brand: { alignItems: 'center', gap: Spacing.md },
  logo: { width: 160, height: 160, borderRadius: Radius.lg },
  title: { ...Typography.title, color: Colors.accent, letterSpacing: 4 },
  welcome: { ...Typography.bodySecondary, textAlign: 'center' },
  actions: { gap: Spacing.sm },
  error: {
    ...Palette.card,
    borderColor: Colors.error,
    gap: Spacing.sm,
  },
  errorText: { ...Typography.body, color: Colors.errorText },
  dev: { ...Palette.card, gap: Spacing.sm },
  devTitle: { ...Typography.caption, letterSpacing: 2 },
  input: {
    ...Typography.body,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    ...Typography.caption,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  chipSelected: { borderColor: Colors.accent, color: Colors.text },
  version: { ...Typography.caption, textAlign: 'center' },
});
