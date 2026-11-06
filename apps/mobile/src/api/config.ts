// EXPO_PUBLIC_* vars are inlined at bundle time only when read with direct dot access.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3100';
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
export const APP_ENV = process.env.EXPO_PUBLIC_ENV ?? 'development';
export const DEV_AUTH = process.env.EXPO_PUBLIC_DEV_AUTH ?? '';
/** Public origin of the web app; also the Google redirect URI on web. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:8083').replace(
  /\/+$/,
  '',
);
