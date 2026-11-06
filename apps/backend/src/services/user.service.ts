import { and, asc, eq, like, or } from 'drizzle-orm';
import type { GoogleIdentity } from '../auth/google.verify.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { discoverableUsersFilter } from './visibility.service.js';

type UserRow = typeof users.$inferSelect;

const FALLBACK_USERNAME = 'player';

/**
 * Static segments registered next to /users/:username (e.g. /users/me). A user holding one of
 * these names would be unreachable by username because the static route always wins.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set(['me']);

/**
 * Display name → username base: accents stripped (NFD), lowercased, whitespace runs → '-'.
 * Characters other than letters, digits, '.', '_' and '-' are dropped because usernames are
 * used as URL path segments.
 */
export function deriveUsernameBase(displayName: string): string {
  const base = displayName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? FALLBACK_USERNAME : base;
}

/** First free, non-reserved name in base, base-1, base-2, ... given the names already taken. */
export function pickAvailableUsername(base: string, taken: ReadonlySet<string>): string {
  const isFree = (name: string) => !taken.has(name) && !RESERVED_USERNAMES.has(name);
  if (isFree(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}`;
    if (isFree(candidate)) return candidate;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function findAvailableUsername(
  db: Pick<Database, 'select'>,
  base: string,
): Promise<string> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(or(eq(users.username, base), like(users.username, `${escapeLike(base)}-%`)));
  return pickAvailableUsername(base, new Set(rows.map((r) => r.username)));
}

/** Splits a free-form display name at its final space into first and last name. */
export function splitDisplayName(displayName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const name = displayName?.trim();
  if (!name) return { firstName: null, lastName: null };
  const lastSpace = name.lastIndexOf(' ');
  if (lastSpace === -1) return { firstName: name, lastName: null };
  return { firstName: name.slice(0, lastSpace).trim(), lastName: name.slice(lastSpace + 1) };
}

export function splitGoogleName(identity: GoogleIdentity): {
  firstName: string | null;
  lastName: string | null;
} {
  if (identity.givenName || identity.familyName) {
    return { firstName: identity.givenName, lastName: identity.familyName };
  }
  return splitDisplayName(identity.name);
}

export function googleDisplayName(identity: GoogleIdentity): string {
  const fromParts = [identity.givenName, identity.familyName].filter(Boolean).join(' ');
  return identity.name ?? (fromParts || identity.email?.split('@')[0] || FALLBACK_USERNAME);
}

export async function findUserByGoogleSub(db: Database, sub: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.googleSub, sub)).limit(1);
  return row;
}

export async function findUserByUsername(
  db: Database,
  username: string,
): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return row;
}

export async function findUserById(db: Database, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

/** The user if the viewer may discover it (see discoverableUsersFilter). */
export async function findVisibleUserByUsername(
  db: Database,
  username: string,
  viewerId: string,
): Promise<UserRow | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username), discoverableUsersFilter(viewerId)))
    .limit(1);
  return row;
}

/** Unknown users and private placeholders the viewer may not discover are both 404. */
export async function requireVisibleUser(
  db: Database,
  username: string,
  viewerId: string,
): Promise<UserRow> {
  const user = await findVisibleUserByUsername(db, username, viewerId);
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  return user;
}

/** Every user the viewer may discover, by username. */
export async function listUsers(db: Database, viewerId: string): Promise<UserRow[]> {
  return db
    .select()
    .from(users)
    .where(discoverableUsersFilter(viewerId))
    .orderBy(asc(users.username));
}

export interface ProfileUpdate {
  firstName?: string | undefined;
  lastName?: string | undefined;
  locale?: string | null | undefined;
  pictureUrl?: string | null | undefined;
}

export async function updateUserProfile(
  db: Database,
  id: string,
  update: ProfileUpdate,
): Promise<UserRow | undefined> {
  const changes: ProfileUpdate = {};
  if (update.firstName !== undefined) changes.firstName = update.firstName;
  if (update.lastName !== undefined) changes.lastName = update.lastName;
  if (update.locale !== undefined) changes.locale = update.locale;
  if (update.pictureUrl !== undefined) changes.pictureUrl = update.pictureUrl;
  const [row] = await db
    .update(users)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return row;
}
