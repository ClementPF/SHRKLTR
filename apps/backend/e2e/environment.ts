// Deliberately fixed, local-only settings. Never load .env or accept a database URL override.
export const API_URL = 'http://127.0.0.1:3191';
export const WEB_URL = 'http://127.0.0.1:8091';
export const CONTROL_URL = 'http://127.0.0.1:3192';
export const DATABASE_URL = 'postgres://sharkulator:sharkulator@127.0.0.1:5433/sharkulator_e2e';
export const DEV_AUTH = 'local-e2e-only-dev-auth-0123456789abcdef';
export const backendEnv = {
  APP_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3191',
  LOG_LEVEL: 'error',
  DATABASE_URL,
  JWT_ACCESS_SECRET: 'local-e2e-only-access-0123456789abcdef',
  JWT_REFRESH_SECRET: 'local-e2e-only-refresh-0123456789abcdef',
  DEV_AUTH_SECRET: DEV_AUTH,
  GOOGLE_CLIENT_ID: 'local-e2e.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_JWKS_URL: 'http://127.0.0.1:1/jwks',
  GOOGLE_TOKEN_URL: 'http://127.0.0.1:1/token',
  PUSH_URL: 'http://127.0.0.1:1/push',
  EXPO_ACCESS_TOKEN: '',
  MAINTENANCE_ENABLED: 'false',
  CORS_ORIGINS: WEB_URL,
  PUBLIC_API_URL: API_URL,
  PUBLIC_WEB_URL: WEB_URL,
};
