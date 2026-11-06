import { router } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Colors, Spacing, Typography } from '@/theme';

// Expo Router reports zero insets on web, where the home-screen app draws under a translucent
// status bar; CSS env() is the only source of the real inset there.
const webInset = (edge: 'top' | 'left' | 'right') =>
  `env(safe-area-inset-${edge}, 0px)` as unknown as number;

export function ScannerHeader() {
  const insets = useSafeAreaInsets();
  const web = Platform.OS === 'web';
  return (
    <View
      testID="scanner-header"
      style={[
        styles.header,
        {
          paddingTop: web ? webInset('top') : insets.top,
          paddingLeft: web ? webInset('left') : insets.left,
          paddingRight: web ? webInset('right') : insets.right,
        },
      ]}
    >
      <View style={styles.row}>
        <Button
          title="Back"
          variant="secondary"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(app)/(tabs)/add-game');
          }}
        />
        <Text style={styles.title} accessibilityRole="header">
          Scan the QR code
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: Colors.background },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    gap: Spacing.md,
  },
  title: { ...Typography.body, fontWeight: '700', flex: 1 },
});
