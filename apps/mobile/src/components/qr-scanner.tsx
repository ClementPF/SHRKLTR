import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { isRepeatedScan, type LastScan } from '@/lib/qr';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export const CAMERA_UNAVAILABLE_TEXT = 'Camera unavailable';
export const CAMERA_DENIED_TEXT = 'No access to camera';
export const CAMERA_PROMPT_TEXT = "Camera access is needed to scan the winner's QR code.";

function useCameraAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    CameraView.isAvailableAsync().then(
      (value) => live && setAvailable(value),
      () => live && setAvailable(false),
    );
    return () => {
      live = false;
    };
  }, []);
  return available;
}

function Notice({
  title,
  body,
  testID,
  children,
}: {
  title: string;
  body?: string;
  testID: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.notice} testID={testID}>
      <Text style={styles.noticeTitle}>{title}</Text>
      {body && <Text style={styles.noticeBody}>{body}</Text>}
      {children}
    </View>
  );
}

/**
 * Live QR scanner. Every distinct code is reported (multi-scan for team games); the same code
 * staying in view is reported once per repeat window.
 */
export function QrScanner({ onScanned }: { onScanned(data: string): void }) {
  const available = useCameraAvailable();
  const [permission, requestPermission] = useCameraPermissions();
  const lastScan = useRef<LastScan | null>(null);

  const undetermined = permission?.status === 'undetermined';
  useEffect(() => {
    // Browsers only show the prompt reliably from a user gesture, so web waits for the button.
    if (Platform.OS !== 'web' && available && undetermined) void requestPermission();
  }, [available, undetermined, requestPermission]);

  if (available === null || !permission) {
    return <Notice testID="scanner-checking" title="Starting the camera…" />;
  }
  if (!available) {
    return (
      <Notice
        testID="scanner-unavailable"
        title={CAMERA_UNAVAILABLE_TEXT}
        body="No camera was found on this device. Scan the winner's QR code from a phone, or use Get Scanned to show your own code to a team mate."
      />
    );
  }
  if (!permission.granted) {
    const denied = permission.status === 'denied';
    return (
      <Notice
        testID={denied ? 'scanner-denied' : 'scanner-permission'}
        title={denied ? CAMERA_DENIED_TEXT : CAMERA_PROMPT_TEXT}
        body={
          denied
            ? 'Allow camera access in your browser or device settings to scan QR codes.'
            : undefined
        }
      >
        {permission.canAskAgain && (
          <Button
            title={denied ? 'Try again' : 'Allow camera'}
            onPress={() => void requestPermission()}
          />
        )}
      </Notice>
    );
  }

  const handleScan = ({ data }: BarcodeScanningResult) => {
    const now = Date.now();
    if (isRepeatedScan(lastScan.current, data, now)) return;
    lastScan.current = { data, at: now };
    onScanned(data);
  };

  return (
    <View style={styles.camera} testID="scanner-camera">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleScan}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { height: 300, overflow: 'hidden', backgroundColor: Colors.background },
  notice: {
    ...Palette.card,
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  noticeTitle: { ...Typography.body, fontWeight: '700', textAlign: 'center' },
  noticeBody: { ...Typography.bodySecondary, textAlign: 'center' },
});
