import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { APP_ENV } from '@/api/config';
import { Colors, Radius, Spacing, Typography } from '@/theme';

export const QR_SIZE = 220;

/** Non-production builds print the encoded payload so it can be copied without a camera. */
export const SHOW_QR_PAYLOAD = APP_ENV !== 'production';

export function QrDisplay({ value }: { value: string }) {
  return (
    <View style={styles.container}>
      {/* Scanners need dark modules on a light background, even in the dark theme. */}
      <View style={styles.code} testID="qr-code" accessibilityLabel="QR code" accessible>
        <QRCode value={value} size={QR_SIZE} color="#000000" backgroundColor="#FFFFFF" />
      </View>
      {SHOW_QR_PAYLOAD && (
        <Text style={styles.payload} testID="qr-payload" selectable>
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: Spacing.sm },
  code: { backgroundColor: '#FFFFFF', padding: Spacing.md, borderRadius: Radius.md },
  payload: { ...Typography.caption, color: Colors.textMuted, textAlign: 'center' },
});
