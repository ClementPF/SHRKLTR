import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { ApiError } from '../lib/errors.js';
import { sendPush } from './push.service.js';
import { findUserById, findUserByUsername } from './user.service.js';

export const DEFAULT_CHALLENGE_MESSAGE = 'I demand a trial by combat.';

export interface ChallengeRequest {
  callerId: string;
  targetUsername: string;
  /** Optional explicit challenger username; must match the authenticated user. */
  challenger?: string | undefined;
  message?: string | undefined;
}

export interface ChallengeDeps {
  db: Database;
  pushUrl: string;
  log: FastifyBaseLogger;
}

export async function challengeUser(deps: ChallengeDeps, req: ChallengeRequest): Promise<void> {
  const caller = await findUserById(deps.db, req.callerId);
  if (!caller) throw ApiError.unauthorized('Authenticated user no longer exists', 'USER_NOT_FOUND');
  if (req.challenger !== undefined && req.challenger !== caller.username) {
    throw ApiError.forbidden('Only the authenticated user can issue a challenge');
  }

  const target = await findUserByUsername(deps.db, req.targetUsername);
  if (!target) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  if (!target.pushToken) {
    throw ApiError.badRequest(
      `${target.username} doesn't accept challenges or doesn't have push notifications turned on.`,
      'PUSH_TOKEN_MISSING',
    );
  }

  await sendPush(
    deps.pushUrl,
    {
      to: target.pushToken,
      title: `${caller.firstName || caller.username} is challenging you.`,
      body: req.message ?? DEFAULT_CHALLENGE_MESSAGE,
      payload: { type: 'challenge', challenger: caller.username },
    },
    deps.log,
  );
}
