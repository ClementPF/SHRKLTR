import { router, Stack } from 'expo-router';
import { Platform, View } from 'react-native';

import { DropdownAlert } from '@/components/dropdown-alert';
import { HeaderButton } from '@/components/header-button';
import { useWebStatusBarHeight } from '@/lib/use-web-status-bar-height';
import { Colors, Palette } from '@/theme';

export const unstable_settings = {
  // Deep links and reloads of pushed screens (e.g. /games/:id) keep the tabs below them.
  anchor: '(tabs)',
};

function closePicker() {
  if (router.canGoBack()) router.back();
  else router.replace('/add-game');
}

export default function AppLayout() {
  const webStatusBarHeight = useWebStatusBarHeight();
  return (
    <View style={Palette.screen}>
      {/*
        Pushed screens get their header from these static options. Turning the header on from
        inside a screen (setOptions after mount) can leave the native iOS header collapsed under
        the status bar, and an explicit opaque header keeps iOS 26 from defaulting to a
        transparent one that overlaps the content. Presentation and back behavior are static
        for the same reason: they must be known before the screen is pushed.
      */}
      <Stack
        screenOptions={{
          headerShown: true,
          headerTransparent: false,
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerBackButtonDisplayMode: 'minimal',
          // Only the web stack reads this; it renders the JS header, which pads by it.
          ...(webStatusBarHeight !== undefined && { headerStatusBarHeight: webStatusBarHeight }),
        }}
      >
        {/* Pushed screens label their back button with this title instead of the group name. */}
        <Stack.Screen name="(tabs)" options={{ title: 'Back', headerShown: false }} />
        <Stack.Screen
          name="game-form/tournament"
          options={{
            presentation: 'modal',
            // An iOS sheet has no back button; Android and web keep their own.
            headerLeft:
              Platform.OS === 'ios'
                ? () => <HeaderButton title="Cancel" onPress={closePicker} />
                : undefined,
          }}
        />
        {/*
          The game is saved: going back would reopen "did you win or lose?". The screen offers
          the next steps instead.
        */}
        <Stack.Screen
          name="game-form/result"
          options={{ headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }}
        />
      </Stack>
      <DropdownAlert />
    </View>
  );
}
