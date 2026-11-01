// EXPO_PUBLIC_* vars are inlined at bundle time only when read with direct dot access.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3100';
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
