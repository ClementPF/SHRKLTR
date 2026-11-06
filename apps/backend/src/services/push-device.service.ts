import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { Expo } from 'expo-server-sdk';
import type { Database } from '../db/client.js';
import { pushDevices, pushPlatform } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';

export type PushPlatform = (typeof pushPlatform.enumValues)[number];
export type PushDeviceRow = typeof pushDevices.$inferSelect;

export interface PushDeviceRegistration {
  installationId: string;
  expoToken: string;
  platform: PushPlatform;
}

/**
 * Upserts the caller's installation with its current Expo token and reactivates it. A token has a
 * single owner: whichever row held it before (another installation or another account on the
 * same phone) is removed in the same transaction.
 */
export async function registerPushDevice(
  db: Database,
  userId: string,
  input: PushDeviceRegistration,
  now: Date,
): Promise<void> {
  const expoToken = input.expoToken.trim();
  if (!Expo.isExpoPushToken(expoToken)) {
    throw ApiError.badRequest('expoToken is not an Expo push token', 'INVALID_PUSH_TOKEN');
  }
  await db.transaction(async (tx) => {
    // Serializes concurrent registrations of one token so its ownership moves atomically.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`push_token:${expoToken}`}, 0))`,
    );
    await tx
      .delete(pushDevices)
      .where(
        and(
          eq(pushDevices.expoToken, expoToken),
          or(ne(pushDevices.userId, userId), ne(pushDevices.installationId, input.installationId)),
        ),
      );
    await tx
      .insert(pushDevices)
      .values({
        userId,
        installationId: input.installationId,
        expoToken,
        platform: input.platform,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [pushDevices.userId, pushDevices.installationId],
        set: { expoToken, platform: input.platform, lastSeenAt: now, disabledAt: null },
      });
  });
}

/** Disables the caller's own installation; unknown or foreign installations are a no-op. */
export async function unregisterPushDevice(
  db: Database,
  userId: string,
  installationId: string,
  now: Date,
): Promise<void> {
  await db
    .update(pushDevices)
    .set({ disabledAt: now })
    .where(
      and(
        eq(pushDevices.userId, userId),
        eq(pushDevices.installationId, installationId),
        isNull(pushDevices.disabledAt),
      ),
    );
}

export function listActivePushDevices(db: Database, userId: string): Promise<PushDeviceRow[]> {
  return db
    .select()
    .from(pushDevices)
    .where(and(eq(pushDevices.userId, userId), isNull(pushDevices.disabledAt)));
}

/**
 * Disables a device Expo reported as DeviceNotRegistered, only if it still holds the token the
 * ticket was for, so a late ticket never disables a freshly rotated token.
 */
export async function disablePushDeviceToken(
  db: Database,
  deviceId: string,
  expoToken: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(pushDevices)
    .set({ disabledAt: now })
    .where(
      and(
        eq(pushDevices.id, deviceId),
        eq(pushDevices.expoToken, expoToken),
        isNull(pushDevices.disabledAt),
      ),
    )
    .returning({ id: pushDevices.id });
  return rows.length > 0;
}
