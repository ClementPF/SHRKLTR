import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmTitle: string;
  loading?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** In-app confirmation, because React Native's `Alert.alert` buttons do nothing on web. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmTitle,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} testID="confirm-dialog" accessibilityRole="alert">
          <Text style={Typography.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onCancel}
              disabled={loading}
              style={styles.action}
            />
            <Button
              title={confirmTitle}
              onPress={onConfirm}
              loading={loading}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  dialog: { ...Palette.card, gap: Spacing.md },
  message: { ...Typography.body, color: Colors.textSecondary },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1 },
});
