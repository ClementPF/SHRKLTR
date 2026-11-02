import { api } from '@/api/client';
import { APP_ENV, DEV_AUTH } from '@/api/config';
import type { SessionResponse } from '@/api/types';

/** Usernames created by `npm run seed -w apps/backend`. */
export const DEV_USERNAMES = ['dev-alex', 'dev-sam', 'dev-jordan', 'dev-taylor', 'dev-morgan'];

export function isDevSessionEnabled(): boolean {
  return APP_ENV !== 'production' && DEV_AUTH.length > 0;
}

export async function requestDevSession(username: string): Promise<SessionResponse> {
  if (!isDevSessionEnabled()) {
    throw new Error('Dev sessions are disabled in this build.');
  }
  return api.post<SessionResponse>(
    '/auth/dev-token',
    { username },
    { auth: false, headers: { 'x-dev-auth': DEV_AUTH } },
  );
}
