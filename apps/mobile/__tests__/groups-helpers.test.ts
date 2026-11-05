import { QueryClient } from '@tanstack/react-query';

import type { Group, GroupMember, GroupRole, Tournament, User } from '@/api/types';
import { ApiError } from '@/api/errors';
import {
  PENDING_JOIN_KEY,
  PENDING_JOIN_TTL_MS,
  clearPendingJoin,
  readPendingJoin,
  savePendingJoin,
} from '@/auth/pending-join';
import {
  GROUP_NAME_REQUIRED_TEXT,
  GROUP_NAME_TOO_LONG_TEXT,
  groupNameProblem,
} from '@/features/groups/create-group-screen';
import { memberActions } from '@/features/groups/members-screen';
import { normalizeInviteCode } from '@/features/groups/pending-join';
import { evictGroupData, groupKeys, isGroupMissing } from '@/features/groups/queries';
import { managedGroups } from '@/features/tournaments/create-tournament-screen';
import { tournamentKeys } from '@/features/tournaments/queries';
import { joinGroupAppUrl } from '@/lib/app-links';

import { memoryStorage } from '../test-utils/session';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: jest.fn() }));
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));

const user = (username: string): User => ({
  id: `id-${username}`,
  username,
  accountType: 'REGISTERED',
  firstName: null,
  lastName: null,
  pictureUrl: null,
  locale: null,
});

const member = (username: string, role: GroupRole): GroupMember => ({
  user: user(username),
  role,
  joinedAt: '2026-11-01T00:00:00.000Z',
});

const group = (id: string, role: GroupRole): Group => ({
  id,
  name: `Group ${id}`,
  role,
  memberCount: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
});

describe('invite codes', () => {
  it.each([
    ['abcd234xyz', 'ABCD234XYZ'],
    ['  abcd-234-xyz ', 'ABCD234XYZ'],
    ['AbCd 234\tXyZ', 'ABCD234XYZ'],
    ['--', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });

  it('builds the app-scheme join link', () => {
    expect(joinGroupAppUrl('tok/en 1')).toBe('com.elo.sharkulator:///join/tok%2Fen%201');
  });
});

describe('group name validation', () => {
  it('requires a non-blank name and caps the trimmed length at 100', () => {
    expect(groupNameProblem('')).toBe(GROUP_NAME_REQUIRED_TEXT);
    expect(groupNameProblem('   ')).toBe(GROUP_NAME_REQUIRED_TEXT);
    expect(groupNameProblem('Office Pong')).toBeNull();
    expect(groupNameProblem(`  ${'x'.repeat(100)}  `)).toBeNull();
    expect(groupNameProblem('x'.repeat(101))).toBe(GROUP_NAME_TOO_LONG_TEXT);
  });
});

describe('member actions per role', () => {
  const me = 'id-me';
  const owner = member('olivia', 'OWNER');
  const admin = member('adam', 'ADMIN');
  const plain = member('mia', 'MEMBER');
  const self: GroupMember = { ...member('me', 'ADMIN'), user: { ...user('me'), id: me } };

  it('lets the owner promote, demote, transfer and remove everyone else', () => {
    expect(memberActions('OWNER', plain, me)).toEqual(['make-admin', 'make-owner', 'remove']);
    expect(memberActions('OWNER', admin, me)).toEqual(['make-member', 'make-owner', 'remove']);
  });

  it('lets an admin remove only ordinary members', () => {
    expect(memberActions('ADMIN', plain, me)).toEqual(['remove']);
    expect(memberActions('ADMIN', admin, me)).toEqual([]);
    expect(memberActions('ADMIN', owner, me)).toEqual([]);
  });

  it('gives members no actions, and nobody actions on themselves or the owner', () => {
    expect(memberActions('MEMBER', plain, me)).toEqual([]);
    expect(memberActions('MEMBER', admin, me)).toEqual([]);
    expect(memberActions('OWNER', self, me)).toEqual([]);
    expect(memberActions('OWNER', owner, me)).toEqual([]);
  });
});

describe('pending join storage', () => {
  it('round-trips a link invitation and a code', async () => {
    const { storage } = memoryStorage();
    await savePendingJoin({ token: 'tok', groupName: 'Shark Tank' }, storage, 1_000);
    expect(await readPendingJoin(storage, 2_000)).toEqual({
      type: 'join',
      token: 'tok',
      groupName: 'Shark Tank',
      savedAt: 1_000,
    });
    await savePendingJoin({ code: 'ABCD234XYZ' }, storage, 1_000);
    expect(await readPendingJoin(storage, 2_000)).toEqual({
      type: 'join',
      code: 'ABCD234XYZ',
      savedAt: 1_000,
    });
  });

  it('drops expired and corrupt entries', async () => {
    const { storage, data } = memoryStorage();
    await savePendingJoin({ code: 'ABCD234XYZ' }, storage, 0);
    expect(await readPendingJoin(storage, PENDING_JOIN_TTL_MS + 1)).toBeNull();
    expect(data.has(PENDING_JOIN_KEY)).toBe(false);

    data.set(PENDING_JOIN_KEY, '{not json');
    expect(await readPendingJoin(storage)).toBeNull();
    data.set(PENDING_JOIN_KEY, JSON.stringify({ type: 'claim', token: 't', savedAt: Date.now() }));
    expect(await readPendingJoin(storage)).toBeNull();
    expect(data.has(PENDING_JOIN_KEY)).toBe(false);
  });

  it('clears the intent', async () => {
    const { storage, data } = memoryStorage();
    await savePendingJoin({ token: 'tok', groupName: 'G' }, storage);
    await clearPendingJoin(storage);
    expect(data.has(PENDING_JOIN_KEY)).toBe(false);
  });
});

describe('group picker options', () => {
  it('offers only groups the user owns or administers', () => {
    const groups = [group('a', 'OWNER'), group('b', 'ADMIN'), group('c', 'MEMBER')];
    expect(managedGroups(groups).map((g) => g.id)).toEqual(['a', 'b']);
    expect(managedGroups(undefined)).toEqual([]);
  });
});

describe('losing access to a group', () => {
  const grouped: Tournament = {
    id: 't-cup',
    name: 'sharktankcup',
    displayName: 'Shark Tank Cup',
    isOver: false,
    sport: { id: 's1', name: 'darts' },
    owner: null,
    group: { id: 'g1', name: 'Shark Tank' },
  };

  it('treats 404 and malformed ids as missing, other failures as errors', () => {
    expect(isGroupMissing(new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found'))).toBe(true);
    expect(isGroupMissing(new ApiError(400, 'VALIDATION_ERROR', 'Bad id'))).toBe(true);
    expect(isGroupMissing(new ApiError(500, 'INTERNAL', 'Boom'))).toBe(false);
    expect(isGroupMissing(new Error('offline'))).toBe(false);
  });

  it('evicts the group data and its tournaments but keeps unrelated groups', () => {
    const client = new QueryClient();
    client.setQueryData(groupKeys.detail('g1'), group('g1', 'MEMBER'));
    client.setQueryData(groupKeys.tournaments('g1'), [grouped]);
    client.setQueryData(groupKeys.players('g1'), []);
    client.setQueryData(groupKeys.members('g1'), { pages: [[]], pageParams: [0] });
    client.setQueryData(tournamentKeys.stats('sharktankcup'), []);
    client.setQueryData(tournamentKeys.list(), [grouped]);
    client.setQueryData(groupKeys.list(), [group('g1', 'MEMBER'), group('g2', 'OWNER')]);
    client.setQueryData(groupKeys.detail('g2'), group('g2', 'OWNER'));

    evictGroupData(client, 'g1');

    expect(client.getQueryData(groupKeys.tournaments('g1'))).toBeUndefined();
    expect(client.getQueryData(groupKeys.players('g1'))).toBeUndefined();
    expect(client.getQueryData(groupKeys.members('g1'))).toBeUndefined();
    expect(client.getQueryData(tournamentKeys.stats('sharktankcup'))).toBeUndefined();
    // Unobserved private lists are dropped rather than left to show stale rows.
    expect(client.getQueryData(tournamentKeys.list())).toBeUndefined();
    expect(client.getQueryData(groupKeys.list())).toBeUndefined();
    expect(client.getQueryData(groupKeys.detail('g2'))).toEqual(group('g2', 'OWNER'));
    client.clear();
  });
});
