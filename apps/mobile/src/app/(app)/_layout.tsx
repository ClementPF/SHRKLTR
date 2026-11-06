import { Stack } from 'expo-router';
import { View } from 'react-native';

import { DropdownAlert } from '@/components/dropdown-alert';
import { Colors, Palette } from '@/theme';

export const unstable_settings = {
  // Deep links and reloads of pushed screens (e.g. /games/:id) keep the tabs below them.
  anchor: '(tabs)',
};

export default function AppLayout() {
  return (
    <View style={Palette.screen}>
      {/*
        Pushed screens get their header from these static options. Turning the header on from
        inside a screen (setOptions after mount) can leave the native iOS header collapsed under
        the status bar, and an explicit opaque header keeps iOS 26 from defaulting to a
        transparent one that overlaps the content.
      */}
      <Stack
        screenOptions={{
          headerShown: true,
          headerTransparent: false,
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      >
        {/* Pushed screens label their back button with this title instead of the group name. */}
        <Stack.Screen name="(tabs)" options={{ title: 'Back', headerShown: false }} />
      </Stack>
      <DropdownAlert />
    </View>
  );
}
