import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { copyText } from '@/lib/clipboard';
import { Colors, Radius, Spacing, Typography } from '@/theme';

export const COPIED_TEXT = 'Link copied.';
export const COPY_FAILED_TEXT = "Couldn't copy automatically. Select the link above and copy it.";

export interface CopyableLinkProps {
  url: string;
  testID?: string;
  copy?: (text: string) => Promise<boolean>;
}

/** A selectable link with a Copy button whose feedback reflects the actual clipboard result. */
export function CopyableLink({
  url,
  testID = 'copyable-link',
  copy = copyText,
}: CopyableLinkProps) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const outcome = copiedUrl === url ? state : 'idle';

  const onCopy = async () => {
    setState('copying');
    const ok = await copy(url);
    setCopiedUrl(url);
    setState(ok ? 'copied' : 'failed');
  };

  return (
    <View style={styles.container} testID={testID}>
      <Text selectable style={styles.url} testID={`${testID}-url`}>
        {url}
      </Text>
      <Button
        title="Copy link"
        variant="secondary"
        loading={state === 'copying'}
        onPress={() => void onCopy()}
      />
      {outcome === 'copied' && <Text style={styles.success}>{COPIED_TEXT}</Text>}
      {outcome === 'failed' && (
        <Text style={styles.failure} accessibilityRole="alert">
          {COPY_FAILED_TEXT}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  url: {
    ...Typography.body,
    fontSize: 14,
    backgroundColor: Colors.surfaceRaised,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  success: { ...Typography.caption, color: Colors.success },
  failure: { ...Typography.caption, color: Colors.warning },
});
