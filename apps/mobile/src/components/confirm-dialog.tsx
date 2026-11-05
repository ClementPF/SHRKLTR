import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Colors, Palette, Spacing, Typography } from '@/theme';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmTitle: string;
  loading?: boolean;
  children?: ReactNode;
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
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!loading) onCancel();
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.dialog} testID="confirm-dialog" accessibilityRole="alert">
          <Text style={Typography.title}>{title}</Text>
          <ScrollView contentContainerStyle={styles.details}>
            {children}
            <Text style={styles.message}>{message}</Text>
          </ScrollView>
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
  dialog: { ...Palette.card, gap: Spacing.md, maxHeight: '90%' },
  details: { gap: Spacing.md },
  message: { ...Typography.body, color: Colors.textSecondary },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1 },
});
