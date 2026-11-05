import { Link } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import type { AppSchemeUrl } from '@/lib/app-links';
import { Colors, Palette, Radius, Spacing, Typography } from '@/theme';

export const OPEN_IN_APP_TEXT =
  'Have the Sharkulator app installed? Open this link in the app, or continue here on the web.';

/**
 * Web-only prompt that hands a public link to the installed app through its custom scheme.
 * Inside the native app the page is already in the app, so nothing is shown.
 */
export function OpenInApp({ url }: { url: AppSchemeUrl }) {
  const [dismissed, setDismissed] = useState(false);
  if (Platform.OS !== 'web' || dismissed) return null;

  return (
    <View style={styles.card} testID="open-in-app">
      <Text style={styles.text}>{OPEN_IN_APP_TEXT}</Text>
      {/* _self lets the browser hand the scheme to the OS instead of opening an empty tab. */}
      <Link href={url} target="_self" style={styles.link} testID="open-in-app-link">
        Open in app
      </Link>
      <Button title="Continue on web" variant="secondary" onPress={() => setDismissed(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...Palette.card, gap: Spacing.sm },
  text: { ...Typography.bodySecondary, textAlign: 'center' },
  link: {
    ...Typography.body,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: Colors.accent,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    overflow: 'hidden',
  },
});
