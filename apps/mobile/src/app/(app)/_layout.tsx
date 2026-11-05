import { Stack } from 'expo-router';
import { View } from 'react-native';

import { DropdownAlert } from '@/components/dropdown-alert';
import { Palette } from '@/theme';

export const unstable_settings = {
  // Deep links and reloads of pushed screens (e.g. /games/:id) keep the tabs below them.
  anchor: '(tabs)',
};

export default function AppLayout() {
  return (
    <View style={Palette.screen}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Pushed screens label their back button with this title instead of the group name. */}
        <Stack.Screen name="(tabs)" options={{ title: 'Back' }} />
      </Stack>
      <DropdownAlert />
    </View>
  );
}
