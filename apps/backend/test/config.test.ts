import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { testConfig, testEnv } from './helpers.js';

const required = {
  DATABASE_URL: testEnv.DATABASE_URL,
  JWT_ACCESS_SECRET: testEnv.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: testEnv.JWT_REFRESH_SECRET,
  DEV_AUTH_SECRET: testEnv.DEV_AUTH_SECRET,
  GOOGLE_CLIENT_ID: testEnv.GOOGLE_CLIENT_ID,
};

describe('config', () => {
  it('provides local defaults for the public URLs, CORS, TTLs and maintenance', () => {
    const config = loadConfig(required);
    expect(config.PUBLIC_API_URL).toBe('http://localhost:3100');
    expect(config.PUBLIC_WEB_URL).toBe('http://localhost:8081');
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:8081']);
    expect(config.CLAIM_TTL_DAYS).toBe(30);
    expect(config.GROUP_INVITE_TTL_DAYS).toBe(30);
    expect(config.MAINTENANCE_ENABLED).toBe(true);
    expect(config.EXPO_ACCESS_TOKEN).toBeUndefined();
    expect(config.PUSH_URL).toBe('https://exp.host/--/api/v2/push/send');
  });

  it('disables maintenance in the test configuration', () => {
    expect(testConfig().MAINTENANCE_ENABLED).toBe(false);
  });

  it('parses CORS_ORIGINS as a trimmed CSV of exact origins', () => {
    const config = loadConfig({
      ...required,
      CORS_ORIGINS: ' https://shrkltr.wtchthfck.com , ,http://localhost:8081/ ',
    });
    expect(config.CORS_ORIGINS).toEqual(['https://shrkltr.wtchthfck.com', 'http://localhost:8081']);
  });

  it.each([
    ['a path', 'http://localhost:8081/app'],
    ['a wildcard', 'https://*.example.com'],
    ['a non-http scheme', 'ftp://example.com'],
    ['garbage', 'not a url'],
  ])('rejects a CORS origin with %s', (_label, origin) => {
    expect(() => loadConfig({ ...required, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
  });

  it('strips a trailing slash from the public URLs', () => {
    const config = loadConfig({
      ...required,
      PUBLIC_API_URL: 'https://shrkltr-api.wtchthfck.com/',
      PUBLIC_WEB_URL: 'https://shrkltr.wtchthfck.com/',
    });
    expect(config.PUBLIC_API_URL).toBe('https://shrkltr-api.wtchthfck.com');
    expect(config.PUBLIC_WEB_URL).toBe('https://shrkltr.wtchthfck.com');
  });

  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
  ])('parses MAINTENANCE_ENABLED=%s', (value, expected) => {
    expect(loadConfig({ ...required, MAINTENANCE_ENABLED: value }).MAINTENANCE_ENABLED).toBe(
      expected,
    );
  });

  it('rejects an unparseable MAINTENANCE_ENABLED', () => {
    expect(() => loadConfig({ ...required, MAINTENANCE_ENABLED: 'yes please' })).toThrow(
      /MAINTENANCE_ENABLED/,
    );
  });

  it.each(['0', '-1', '1.5', '366'])('rejects CLAIM_TTL_DAYS=%s', (value) => {
    expect(() => loadConfig({ ...required, CLAIM_TTL_DAYS: value })).toThrow(/CLAIM_TTL_DAYS/);
  });

  it('accepts configured TTLs and an optional Expo access token', () => {
    const config = loadConfig({
      ...required,
      CLAIM_TTL_DAYS: '7',
      GROUP_INVITE_TTL_DAYS: '14',
      EXPO_ACCESS_TOKEN: 'expo-token',
    });
    expect(config.CLAIM_TTL_DAYS).toBe(7);
    expect(config.GROUP_INVITE_TTL_DAYS).toBe(14);
    expect(config.EXPO_ACCESS_TOKEN).toBe('expo-token');
  });

  it('treats an empty EXPO_ACCESS_TOKEN as unset', () => {
    expect(loadConfig({ ...required, EXPO_ACCESS_TOKEN: '' }).EXPO_ACCESS_TOKEN).toBeUndefined();
  });
});
