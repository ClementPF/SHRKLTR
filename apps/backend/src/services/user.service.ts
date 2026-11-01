import { eq, like, or } from 'drizzle-orm';
import type { GoogleIdentity } from '../auth/google.verify.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';

type UserRow = typeof users.$inferSelect;

const FALLBACK_USERNAME = 'player';
const MAX_INSERT_ATTEMPTS = 5;

/** Display name → username base: accents stripped (NFD), lowercased, whitespace runs → '-'. */
export function deriveUsernameBase(displayName: string): string {
  const base = displayName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
  return base === '' ? FALLBACK_USERNAME : base;
}

/** First free name in base, base-1, base-2, ... given the names already taken. */
export function pickAvailableUsername(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function findAvailableUsername(db: Database, base: string): Promise<string> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(or(eq(users.username, base), like(users.username, `${escapeLike(base)}-%`)));
  return pickAvailableUsername(base, new Set(rows.map((r) => r.username)));
}

function splitName(identity: GoogleIdentity): {
  firstName: string | null;
  lastName: string | null;
} {
  if (identity.givenName || identity.familyName) {
    return { firstName: identity.givenName, lastName: identity.familyName };
  }
  const name = identity.name?.trim();
  if (!name) return { firstName: null, lastName: null };
  const lastSpace = name.lastIndexOf(' ');
  if (lastSpace === -1) return { firstName: name, lastName: null };
  return { firstName: name.slice(0, lastSpace).trim(), lastName: name.slice(lastSpace + 1) };
}

function displayNameOf(identity: GoogleIdentity): string {
  const fromParts = [identity.givenName, identity.familyName].filter(Boolean).join(' ');
  return identity.name ?? (fromParts || identity.email?.split('@')[0] || FALLBACK_USERNAME);
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  while (typeof current === 'object' && current !== null) {
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505' && e.constraint_name === constraint) return true;
    current = e.cause;
  }
  return false;
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

/**
 * Creates the user for a Google identity on first login, otherwise refreshes the mutable
 * profile fields. Username and googleSub never change after creation.
 */
export async function upsertGoogleUser(db: Database, identity: GoogleIdentity): Promise<UserRow> {
  const profile = {
    email: identity.email,
    emailVerified: identity.emailVerified,
    ...splitName(identity),
    pictureUrl: identity.picture,
    locale: identity.locale,
  };

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const existing = await findUserByGoogleSub(db, identity.sub);
    if (existing) {
      const [updated] = await db
        .update(users)
        .set({ ...profile, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      if (!updated) throw new Error('user disappeared during profile refresh');
      return updated;
    }

    const username = await findAvailableUsername(db, deriveUsernameBase(displayNameOf(identity)));
    try {
      const [created] = await db
        .insert(users)
        .values({ googleSub: identity.sub, username, ...profile })
        .returning();
      if (!created) throw new Error('user insert returned no row');
      return created;
    } catch (err) {
      // A concurrent login may have taken the username or created this Google user; retry.
      if (
        isUniqueViolation(err, 'users_username_key') ||
        isUniqueViolation(err, 'users_google_sub_key')
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('could not provision user after repeated unique-constraint conflicts');
}
