import { DarkTheme, type Theme } from 'expo-router';

import { Colors } from './index';

export const NavigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.accent,
    background: Colors.background,
    card: Colors.tabBar,
    text: Colors.text,
    border: Colors.border,
    notification: Colors.accent,
  },
};
