import { z } from 'zod';

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** The entry as a bare origin, or undefined if it carries a path, query, credentials or wildcard. */
function toExactOrigin(entry: string): string | undefined {
  if (entry.includes('*') || !URL.canParse(entry)) return undefined;
  const url = new URL(entry);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return entry.replace(/\/$/, '') === url.origin ? url.origin : undefined;
}

const publicUrlSchema = z
  .url({ protocol: /^https?$/ })
  .transform((value) => value.replace(/\/+$/, ''));

const ttlDaysSchema = z.coerce.number().int().min(1).max(365);

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().min(1).default('0.0.0.0'),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  DEV_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_JWKS_URL: z.url().default('https://www.googleapis.com/oauth2/v3/certs'),
  // An empty value (e.g. `GOOGLE_CLIENT_SECRET=` in .env) counts as unset.
  GOOGLE_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  GOOGLE_TOKEN_URL: z.url().default('https://oauth2.googleapis.com/token'),
  GOOGLE_REDIRECT_ALLOWLIST: z.string().default('http://localhost:8081').transform(splitCsv),
  PUSH_URL: z.url().default('https://exp.host/--/api/v2/push/send'),
  /** Upper bound for one Expo push request, response body included. */
  PUSH_TIMEOUT_MS: z.coerce.number().int().min(50).max(60_000).default(5000),
  // Optional server-only bearer token for Expo's enhanced push security; empty counts as unset.
  EXPO_ACCESS_TOKEN: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  /** Canonical public origin of this API (share links, OG tags); never derived from Host. */
  PUBLIC_API_URL: publicUrlSchema.default('http://localhost:3100'),
  /** Public origin of the web app, used for claim, invite and join links. */
  PUBLIC_WEB_URL: publicUrlSchema.default('http://localhost:8081'),
  /** Comma-separated exact origins allowed by CORS. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081')
    .transform((value, ctx) => {
      const origins: string[] = [];
      for (const entry of splitCsv(value)) {
        const origin = toExactOrigin(entry);
        if (origin === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `"${entry}" is not an exact http(s) origin like https://example.com`,
          });
          return z.NEVER;
        }
        origins.push(origin);
      }
      return origins;
    }),
  CLAIM_TTL_DAYS: ttlDaysSchema.default(30),
  GROUP_INVITE_TTL_DAYS: ttlDaysSchema.default(30),
  /** Runs the in-process challenge sweep; disabled in tests, which call the sweep directly. */
  MAINTENANCE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((value) => value === 'true' || value === '1'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
