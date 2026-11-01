import { asc } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sports } from '../db/schema.js';

export type SportRow = typeof sports.$inferSelect;

export async function listSports(db: Database): Promise<SportRow[]> {
  return db.select().from(sports).orderBy(asc(sports.name));
}

/** Returns undefined when a sport with this name already exists. */
export async function createSport(db: Database, name: string): Promise<SportRow | undefined> {
  const [row] = await db
    .insert(sports)
    .values({ name })
    .onConflictDoNothing({ target: sports.name })
    .returning();
  return row;
}
