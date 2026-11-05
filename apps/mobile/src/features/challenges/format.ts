import type { Challenge, ChallengeStatus, User } from '@/api/types';
import { fromNow } from '@/lib/format';

export const STATUS_LABELS: Record<ChallengeStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
};

export const isActive = (challenge: Pick<Challenge, 'status'>) =>
  challenge.status === 'PENDING' || challenge.status === 'ACCEPTED';

/** The sweep expires overdue challenges once a minute, so the list can briefly lag the clock. */
export const isPastDeadline = (challenge: Pick<Challenge, 'deadlineAt'>, now: Date) =>
  new Date(challenge.deadlineAt).getTime() <= now.getTime();

/** The other player of the challenge, from the viewer's side. */
export function rivalOf(challenge: Challenge, viewerId: string | undefined): User {
  return challenge.challenger.id === viewerId ? challenge.opponent : challenge.challenger;
}

/** Only the opponent answers, and only while the challenge is pending and not overdue. */
export function canRespond(challenge: Challenge, viewerId: string | undefined, now: Date) {
  return (
    challenge.status === 'PENDING' &&
    challenge.opponent.id === viewerId &&
    !isPastDeadline(challenge, now)
  );
}

const nameFor = (user: User | null, viewerId: string | undefined) =>
  user && user.id === viewerId ? 'You' : (user?.username ?? 'Someone');

/** One line about where the challenge stands, from the viewer's side. */
export function challengeSummary(
  challenge: Challenge,
  viewerId: string | undefined,
  now: Date,
): string {
  const rival = rivalOf(challenge, viewerId).username;
  const due = fromNow(challenge.deadlineAt, now);
  switch (challenge.status) {
    case 'PENDING':
      if (isPastDeadline(challenge, now)) return `Deadline passed ${due}`;
      return challenge.opponent.id === viewerId
        ? `Waiting for your answer, due ${due}`
        : `Waiting for ${rival} to answer, due ${due}`;
    case 'ACCEPTED':
      return isPastDeadline(challenge, now)
        ? `Deadline passed ${due}`
        : `Play ${rival}, due ${due}`;
    case 'COMPLETED':
      return `${nameFor(challenge.winner, viewerId)} won`;
    case 'DECLINED':
      return `${nameFor(challenge.opponent, viewerId)} declined`;
    case 'EXPIRED':
      return `Expired ${fromNow(challenge.resolvedAt ?? challenge.deadlineAt, now)}`;
  }
}
