import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Colors, Spacing, Typography } from '@/theme';

export function ScannerHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="scanner-header"
      style={[
        styles.header,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
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
