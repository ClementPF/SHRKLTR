import Constants from 'expo-constants';

import { API_URL } from '@/api/config';

const PRIVATE_HOST = [
  /^localhost$/i,
  /^127\./,
  /^\[?::1\]?$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/i,
];

// RN's URL polyfill does not implement `hostname`, so the host is extracted by hand.
function hostOf(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url);
  return match?.[1] ?? null;
}

/** "L" when the app talks to a local/LAN API, "R" for a remote one (legacy settings marker). */
export function apiLocation(url: string = API_URL): 'L' | 'R' {
  const host = hostOf(url);
  return host && PRIVATE_HOST.some((re) => re.test(host)) ? 'L' : 'R';
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

export function versionLabel(version: string = appVersion(), url: string = API_URL): string {
  return `Version : ${version} ${apiLocation(url)}`;
}
