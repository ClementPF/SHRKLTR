import type { User } from '@/api/types';

/** Placeholders were added by name and have not been claimed by a real account yet. */
export function isPlaceholder(user: Pick<User, 'accountType'> | null | undefined): boolean {
  return user?.accountType === 'PLACEHOLDER';
}

/** First and last name when known, else the username. */
export function displayName(user: Pick<User, 'username' | 'firstName' | 'lastName'>): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.username;
}
