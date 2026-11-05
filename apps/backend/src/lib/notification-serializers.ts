import { z } from 'zod';
import { notificationCategory, notificationType } from '../db/schema.js';
import type { NotificationView } from '../services/notification.service.js';
import { toUserDto, userDtoSchema } from './serializers.js';

export const notificationTargetSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('game'), gameId: z.uuid() }),
    z.object({ type: z.literal('challenge'), challengeId: z.uuid() }),
    z.object({ type: z.literal('group'), groupId: z.uuid() }),
    z.object({ type: z.literal('achievements'), username: z.string() }),
    z.object({ type: z.literal('user'), username: z.string() }),
  ])
  .meta({ id: 'NotificationTarget' });

export const notificationDtoSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(notificationType.enumValues),
    category: z.enum(notificationCategory.enumValues),
    title: z.string(),
    body: z.string(),
    target: notificationTargetSchema
      .nullable()
      .describe('Screen to open; null when the source no longer exists'),
    actor: userDtoSchema.nullable(),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Notification' });

export type NotificationDto = z.infer<typeof notificationDtoSchema>;

export function toNotificationDto(view: NotificationView): NotificationDto {
  const { notification } = view;
  return {
    id: notification.id,
    type: notification.type,
    category: notification.category,
    title: view.title,
    body: view.body,
    target: view.target,
    actor: view.actor ? toUserDto(view.actor) : null,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
  };
}

export const notificationPreferencesSchema = z
  .object({
    games: z.boolean(),
    challenges: z.boolean(),
    achievements: z.boolean(),
    claims: z.boolean(),
    groups: z.boolean(),
  })
  .describe('Push toggles per category; the inbox always records every notification')
  .meta({ id: 'NotificationPreferences' });

export const updateNotificationPreferencesSchema = z
  .strictObject({
    games: z.boolean().optional(),
    challenges: z.boolean().optional(),
    achievements: z.boolean().optional(),
    claims: z.boolean().optional(),
    groups: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Provide at least one category',
  })
  .meta({ id: 'UpdateNotificationPreferencesRequest' });
