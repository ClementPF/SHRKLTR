import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import {
  addGroupMember,
  authHeadersFor,
  createGroup,
  createPlaceholderUser,
  createSport,
  createTournament,
  createUser,
  rosterPlayer,
} from './helpers.js';

export type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;
type GroupRow = Awaited<ReturnType<typeof createGroup>>;

export interface GameDto {
  id: string;
  tournament: { name: string; group: { id: string; name: string } | null };
  outcomes: { user: { username: string }; result: string }[];
}

/**
 * Mixed open/private world for privacy tests:
 * - group "Secret Society": alex OWNER, jordan MEMBER; fran was ADMIN and is removed at the end.
 * - privcup (grouped, created by fran) and opencup/quietcup (ungrouped).
 * - guest: placeholder rostered in the group with open and private history.
 * - hidden-guest: placeholder created by jordan, rostered, private history only.
 * - loose-guest: ungrouped placeholder without history.
 * Games alternate between open and private so private rows sit between open ones on every page.
 */
export interface PrivacyFixture {
  alex: UserRow;
  jordan: UserRow;
  pat: UserRow;
  fran: UserRow;
  guest: UserRow;
  hidden: UserRow;
  loose: UserRow;
  group: GroupRow;
  privcup: TournamentRow;
  opencup: TournamentRow;
  quietcup: TournamentRow;
  /** Game ids in play order. */
  games: { id: string; tournament: 'privcup' | 'opencup' }[];
  /** fran's first win (game 2), recorded in privcup. */
  franFirstWinGameId: string;
}

export const call = async (
  app: FastifyInstance,
  user: UserRow | null,
  method: string,
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: user ? await authHeadersFor(app, user.id) : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

export async function buildPrivacyFixture(app: FastifyInstance): Promise<PrivacyFixture> {
  const db = app.db;
  const alex = await createUser(db, { username: 'alex' });
  const jordan = await createUser(db, { username: 'jordan' });
  const pat = await createUser(db, { username: 'pat' });
  const fran = await createUser(db, { username: 'fran' });
  const group = await createGroup(db, {
    ownerId: alex.id,
    name: 'Secret Society',
    members: { [jordan.id]: 'MEMBER' },
  });
  await addGroupMember(db, group.id, fran.id, 'ADMIN');
  const guest = await createPlaceholderUser(db, { username: 'guest', createdByUserId: alex.id });
  const hidden = await createPlaceholderUser(db, {
    username: 'hidden-guest',
    createdByUserId: jordan.id,
  });
  const loose = await createPlaceholderUser(db, {
    username: 'loose-guest',
    createdByUserId: alex.id,
  });
  await rosterPlayer(db, group.id, guest.id);
  await rosterPlayer(db, group.id, hidden.id);

  const privSport = await createSport(db, { name: 'privsport' });
  const openSport = await createSport(db, { name: 'opensport' });
  const privcup = await createTournament(db, {
    name: 'privcup',
    displayName: 'Priv Cup',
    sportId: privSport.id,
    ownerUserId: fran.id,
    groupId: group.id,
  });
  const opencup = await createTournament(db, {
    name: 'opencup',
    displayName: 'Open Cup',
    sportId: openSport.id,
    ownerUserId: pat.id,
  });
  const quietcup = await createTournament(db, {
    name: 'quietcup',
    displayName: 'Quiet Cup',
    sportId: openSport.id,
    ownerUserId: pat.id,
  });

  const games: PrivacyFixture['games'] = [];
  const play = async (
    tournament: 'privcup' | 'opencup',
    winners: UserRow[],
    losers: UserRow[],
    caller: UserRow = losers[0]!,
  ) => {
    const res = await call(app, caller, 'POST', `/tournaments/${tournament}/games`, {
      outcomes: [
        ...winners.map((u) => ({ username: u.username, result: 'WIN' })),
        ...losers.map((u) => ({ username: u.username, result: 'LOSS' })),
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json<{ id: string }>().id;
    games.push({ id, tournament });
    return id;
  };

  await play('opencup', [pat], [fran]);
  const franFirstWinGameId = await play('privcup', [fran], [jordan]);
  await play('opencup', [fran], [pat]);
  await play('privcup', [alex], [fran]);
  await play('opencup', [pat], [fran]);
  await play('privcup', [jordan], [fran]);
  await play('privcup', [alex, jordan], [fran, guest]);
  await play('opencup', [guest], [pat]);
  await play('privcup', [hidden], [alex]);
  await play('privcup', [alex], [jordan]);
  await play('opencup', [alex], [pat]);
  await app.push.drain();

  const removed = await call(app, alex, 'DELETE', `/groups/${group.id}/members/${fran.id}`);
  expect(removed.statusCode, removed.body).toBe(204);

  return {
    alex,
    jordan,
    pat,
    fran,
    guest,
    hidden,
    loose,
    group,
    privcup,
    opencup,
    quietcup,
    games,
    franFirstWinGameId,
  };
}
