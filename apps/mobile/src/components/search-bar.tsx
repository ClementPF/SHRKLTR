import { SymbolView } from 'expo-symbols';
import { StyleSheet, TextInput, View } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export interface SearchBarProps {
  value: string;
  onChangeText(text: string): void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search by name, @id or sports',
}: SearchBarProps) {
  return (
    <View style={styles.container}>
      <SymbolView
        name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
        tintColor={Colors.textMuted}
        size={20}
      />
      <TextInput
        testID="search-bar"
        accessibilityLabel="Search"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
  },
  input: { ...Typography.body, flex: 1, paddingVertical: Spacing.sm },
});
