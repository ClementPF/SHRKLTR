import { Platform, type TextStyle } from 'react-native';

export const Colors = {
  accent: '#CE2924',
  background: '#000000',
  surface: '#121212',
  surfaceRaised: '#1E1E1E',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textSecondary: '#B0B4BA',
  textMuted: '#6B6F76',
  success: '#3DBE6B',
  error: '#CE2728',
  errorText: '#FFFFFF',
  warning: '#EAEB5E',
  warningText: '#666804',
  tabBar: '#000000',
  tabIconDefault: '#FFFFFF',
  tabIconSelected: '#CE2924',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const Radius = {
  sm: 4,
  md: 8,
  lg: 16,
} as const;

const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
});

export const Typography = {
  title: { fontFamily, fontSize: 28, fontWeight: '700', color: Colors.text },
  sectionHeader: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: Colors.text,
    letterSpacing: 1,
  },
  body: { fontFamily, fontSize: 16, fontWeight: '400', color: Colors.text },
  bodySecondary: { fontFamily, fontSize: 16, fontWeight: '400', color: Colors.textSecondary },
  caption: { fontFamily, fontSize: 13, fontWeight: '500', color: Colors.textMuted },
} satisfies Record<string, TextStyle>;

export const Palette = {
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  sectionHeader: {
    ...Typography.sectionHeader,
    paddingVertical: Spacing.sm,
    textAlign: 'center',
    backgroundColor: Colors.background,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  input: {
    ...Typography.body,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
} as const;
