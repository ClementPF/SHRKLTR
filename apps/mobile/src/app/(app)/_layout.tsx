import { Stack } from 'expo-router';
import { View } from 'react-native';

import { DropdownAlert } from '@/components/dropdown-alert';
import { Palette } from '@/theme';

export default function AppLayout() {
  return (
    <View style={Palette.screen}>
      <Stack screenOptions={{ headerShown: false }} />
      <DropdownAlert />
    </View>
  );
}
