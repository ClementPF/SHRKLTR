import { z } from 'zod';
import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENTS,
  findAchievement,
  type AchievementDefinition,
} from '../achievements/catalog.js';
import { achievementSource } from '../db/schema.js';
import type { UnlockView } from '../services/achievement.service.js';
import { toUserDto, userDtoSchema } from './serializers.js';

type UserRow = Parameters<typeof toUserDto>[0];

export const achievementDtoSchema = z
  .object({
    code: z.enum(ACHIEVEMENT_CODES),
    title: z.string(),
    description: z.string(),
  })
  .meta({ id: 'Achievement' });

export type AchievementDto = z.infer<typeof achievementDtoSchema>;

const achievementSourceDtoSchema = z
  .object({
    type: z.enum(achievementSource.enumValues),
    gameId: z
      .uuid()
      .nullable()
      .describe('Game that unlocked the badge; null when there is none or you cannot see it'),
    groupId: z
      .uuid()
      .nullable()
      .describe('Group that unlocked the badge; null when there is none or you are not a member'),
    challengeId: z
      .uuid()
      .nullable()
      .describe('Challenge that unlocked the badge; null when there is none or you cannot open it'),
  })
  .meta({ id: 'AchievementSource' });

export const userAchievementDtoSchema = achievementDtoSchema
  .extend({
    unlocked: z.boolean(),
    unlockedAt: z.iso.datetime().nullable(),
    source: achievementSourceDtoSchema.nullable().describe('Null while locked'),
  })
  .meta({ id: 'UserAchievement' });

export type UserAchievementDto = z.infer<typeof userAchievementDtoSchema>;

export const achievementUnlockDtoSchema = z
  .object({
    user: userDtoSchema,
    achievement: achievementDtoSchema,
    unlockedAt: z.iso.datetime(),
    source: achievementSourceDtoSchema,
  })
  .meta({ id: 'AchievementUnlock' });

export type AchievementUnlockDto = z.infer<typeof achievementUnlockDtoSchema>;

export function toAchievementDto(definition: AchievementDefinition): AchievementDto {
  return { code: definition.code, title: definition.title, description: definition.description };
}

function toSourceDto(view: UnlockView) {
  return {
    type: view.achievement.sourceType,
    gameId: view.visibleSourceGameId,
    groupId: view.visibleSourceGroupId,
    challengeId: view.visibleSourceChallengeId,
  };
}

/** The whole catalog in display order, each entry locked or unlocked for this user. */
export function toUserAchievementDtos(unlocks: readonly UnlockView[]): UserAchievementDto[] {
  const byCode = new Map(unlocks.map((u) => [u.achievement.achievementCode, u]));
  return ACHIEVEMENTS.map((definition) => {
    const unlock = byCode.get(definition.code);
    return {
      ...toAchievementDto(definition),
      unlocked: unlock !== undefined,
      unlockedAt: unlock ? unlock.achievement.unlockedAt.toISOString() : null,
      source: unlock ? toSourceDto(unlock) : null,
    };
  });
}

export function toAchievementUnlockDtos(
  user: UserRow,
  unlocks: readonly UnlockView[],
): AchievementUnlockDto[] {
  return unlocks.flatMap((unlock) => {
    const definition = findAchievement(unlock.achievement.achievementCode);
    if (!definition) return [];
    return [
      {
        user: toUserDto(user),
        achievement: toAchievementDto(definition),
        unlockedAt: unlock.achievement.unlockedAt.toISOString(),
        source: toSourceDto(unlock),
      },
    ];
  });
}
