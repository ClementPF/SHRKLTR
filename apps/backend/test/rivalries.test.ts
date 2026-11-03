import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rivalryStats, stats } from '../src/db/schema.js';
import { refreshRivalrySelection } from '../src/services/stats.service.js';
import {
  authHeadersFor,
  buildTestApp,
  createStatsRow,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;

const eloDelta = (winnerRating: number, loserRating: number) =>
  32 * (1 - 1 / (1 + 10 ** ((loserRating - winnerRating) / 400)));

describe('rivalries', () => {
  let app: FastifyInstance;
  let tournament: TournamentRow;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
  let dave: UserRow;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    tournament = await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
    carol = await createUser(app.db, { username: 'carol' });
    dave = await createUser(app.db, { username: 'dave' });
  });

  const play = async (winners: UserRow[], losers: UserRow[]) => {
    const caller = losers[0];
    if (!caller) throw new Error('a game needs a loser');
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.name}/games`,
      headers: await authHeadersFor(app, caller.id),
      payload: {
        outcomes: [
          ...winners.map((u) => ({ username: u.username, result: 'WIN' })),
          ...losers.map((u) => ({ username: u.username, result: 'LOSS' })),
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { outcomes: { user: { id: string }; scoreValue: number }[] };
    return new Map(body.outcomes.map((o) => [o.user.id, o.scoreValue]));
  };

  const rivalry = async (user: UserRow, rival: UserRow) => {
    const [row] = await app.db
      .select()
      .from(rivalryStats)
      .where(
        and(
          eq(rivalryStats.userId, user.id),
          eq(rivalryStats.rivalId, rival.id),
          eq(rivalryStats.tournamentId, tournament.id),
        ),
      );
    return row;
  };

  const statsOf = async (user: UserRow) => {
    const [row] = await app.db
      .select()
      .from(stats)
      .where(and(eq(stats.userId, user.id), eq(stats.tournamentId, tournament.id)));
    return row;
  };

  describe('VAL-GAME-006: rivalry recalculation (ported RivalryServiceTest invariants)', () => {
    it('a 1v1 creates both directional rows starting from 0', async () => {
      await play([bob], [alice]);
      const bobVsAlice = await rivalry(bob, alice);
      const aliceVsBob = await rivalry(alice, bob);
      expect(bobVsAlice).toMatchObject({
        score: 16,
        bestScore: 16,
        worstScore: 0,
        gameCount: 1,
        winCount: 1,
        loseCount: 0,
        winStreak: 1,
        longuestWinStreak: 1,
      });
      expect(aliceVsBob).toMatchObject({
        score: -16,
        bestScore: 0,
        worstScore: -16,
        gameCount: 1,
        winCount: 0,
        loseCount: 1,
        loseStreak: 1,
        longuestLoseStreak: 1,
      });
      expect(await app.db.select().from(rivalryStats)).toHaveLength(2);
    });

    it('after N 1v1 games scores accumulate deltas and mirror exactly', async () => {
      const sequence: [UserRow, UserRow][] = [
        [bob, alice],
        [bob, alice],
        [alice, bob],
        [bob, alice],
        [alice, bob],
      ];
      let expected = 0;
      for (const [winner, loser] of sequence) {
        const deltas = await play([winner], [loser]);
        expected += deltas.get(bob.id) ?? NaN;
      }
      const bobVsAlice = await rivalry(bob, alice);
      const aliceVsBob = await rivalry(alice, bob);
      expect(bobVsAlice?.score).toBeCloseTo(expected, 9);
      expect(aliceVsBob?.score).toBe(-(bobVsAlice?.score ?? NaN));
      expect(bobVsAlice?.gameCount).toBe(sequence.length);
      expect(aliceVsBob?.gameCount).toBe(sequence.length);
      expect(bobVsAlice?.winCount).toBe(aliceVsBob?.loseCount);
      expect(bobVsAlice?.loseCount).toBe(aliceVsBob?.winCount);
      expect(bobVsAlice).toMatchObject({ winCount: 3, loseCount: 2, longuestWinStreak: 2 });
    });

    it('NvN gives every cross-team pair the full participant delta and no teammate rows', async () => {
      await createStatsRow(app.db, { userId: bob.id, tournamentId: tournament.id, score: 1100 });
      const first = await play([bob, carol], [alice, dave]);
      const d1 = eloDelta((1100 + 1000) / 2, 1000);
      expect(first.get(bob.id)).toBeCloseTo(d1, 9);

      const second = await play([alice, dave], [bob, carol]);
      const d2 = second.get(alice.id) ?? NaN;

      const rows = await app.db.select().from(rivalryStats);
      expect(rows).toHaveLength(8);
      const teammates = new Set([`${bob.id}:${carol.id}`, `${alice.id}:${dave.id}`]);
      for (const r of rows) {
        expect(teammates.has(`${r.userId}:${r.rivalId}`)).toBe(false);
        expect(teammates.has(`${r.rivalId}:${r.userId}`)).toBe(false);
      }
      for (const winner of [bob, carol]) {
        for (const loser of [alice, dave]) {
          const forward = await rivalry(winner, loser);
          const reverse = await rivalry(loser, winner);
          // Full delta per pair, never divided by the opposing team size.
          expect(forward?.score).toBeCloseTo(d1 - d2, 9);
          expect(reverse?.score).toBe(-(forward?.score ?? NaN));
          expect(forward?.gameCount).toBe(2);
          expect(reverse?.gameCount).toBe(2);
          expect(forward).toMatchObject({ winCount: 1, loseCount: 1, loseStreak: 1 });
        }
      }
    });

    it('rivalry rows are scoped to their tournament', async () => {
      const other = await createTournament(app.db, { name: 'chess', displayName: 'Chess' });
      await play([bob], [alice]);
      const rows = await app.db
        .select()
        .from(rivalryStats)
        .where(eq(rivalryStats.tournamentId, other.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('VAL-GAME-007: best/worst rivalry selection (ported StatsServiceTest)', () => {
    it('a win creates a best rivalry (whenNoBestRivalry_WinShouldCreateOne)', async () => {
      await play([bob], [alice]);
      const bobStats = await statsOf(bob);
      expect(bobStats?.bestRivalryId).toBe((await rivalry(bob, alice))?.id);
      expect(bobStats?.worstRivalryId).toBeNull();
    });

    it('a loss does not create a best rivalry (whenNoBestRivalry_LossShouldNotCreateOne)', async () => {
      await play([bob], [alice]);
      const aliceStats = await statsOf(alice);
      expect(aliceStats?.bestRivalryId).toBeNull();
      expect(aliceStats?.worstRivalryId).toBe((await rivalry(alice, bob))?.id);
    });

    it('selects the strongest positive rivalry across several rivals', async () => {
      await play([alice], [bob]);
      await play([alice], [carol]);
      const vsBob = await rivalry(alice, bob);
      const vsCarol = await rivalry(alice, carol);
      expect(vsBob!.score).toBeGreaterThan(vsCarol!.score);
      expect((await statsOf(alice))?.bestRivalryId).toBe(vsBob?.id);
    });

    it('re-selects the best remaining rivalry when the selected one crosses sign', async () => {
      await play([alice], [bob]);
      await play([alice], [carol]);
      await play([bob], [alice]);
      const vsBob = await rivalry(alice, bob);
      const vsCarol = await rivalry(alice, carol);
      expect(vsBob!.score).toBeLessThan(0);
      expect(vsCarol!.score).toBeGreaterThan(0);
      const aliceStats = await statsOf(alice);
      expect(aliceStats?.bestRivalryId).toBe(vsCarol?.id);
      expect(aliceStats?.worstRivalryId).toBe(vsBob?.id);
    });

    it('removes the best rivalry when it goes negative and nothing positive remains', async () => {
      await play([alice], [bob]);
      expect((await statsOf(alice))?.bestRivalryId).toBe((await rivalry(alice, bob))?.id);
      await play([bob], [alice]);
      const vsBob = await rivalry(alice, bob);
      expect(vsBob!.score).toBeLessThan(0);
      const aliceStats = await statsOf(alice);
      expect(aliceStats?.bestRivalryId).toBeNull();
      expect(aliceStats?.worstRivalryId).toBe(vsBob?.id);
      // Mirror for bob: his worst crossed to positive and becomes his best.
      const bobStats = await statsOf(bob);
      expect(bobStats?.worstRivalryId).toBeNull();
      expect(bobStats?.bestRivalryId).toBe((await rivalry(bob, alice))?.id);
    });

    describe('exact replacement scenarios', () => {
      const seedRivalry = async (rival: UserRow, score: number) => {
        const [row] = await app.db
          .insert(rivalryStats)
          .values({
            userId: alice.id,
            rivalId: rival.id,
            tournamentId: tournament.id,
            score,
            bestScore: Math.max(0, score),
            worstScore: Math.min(0, score),
          })
          .returning();
        return row!;
      };
      const setScore = (id: string, score: number) =>
        app.db.update(rivalryStats).set({ score }).where(eq(rivalryStats.id, id));
      const refresh = () =>
        app.db.transaction((tx) => refreshRivalrySelection(tx, alice.id, tournament.id));

      it('best 20 deteriorating to 18 is replaced by the 19 candidate', async () => {
        const twenty = await seedRivalry(bob, 20);
        const nineteen = await seedRivalry(carol, 19);
        await createStatsRow(app.db, {
          userId: alice.id,
          tournamentId: tournament.id,
          bestRivalryId: twenty.id,
        });
        await refresh();
        expect((await statsOf(alice))?.bestRivalryId).toBe(twenty.id);

        await setScore(twenty.id, 18);
        await refresh();
        expect((await statsOf(alice))?.bestRivalryId).toBe(nineteen.id);
      });

      it('worst -20 improving to -18 is replaced by the -19 candidate', async () => {
        const minusTwenty = await seedRivalry(bob, -20);
        const minusNineteen = await seedRivalry(carol, -19);
        await createStatsRow(app.db, {
          userId: alice.id,
          tournamentId: tournament.id,
          worstRivalryId: minusTwenty.id,
        });
        await refresh();
        expect((await statsOf(alice))?.worstRivalryId).toBe(minusTwenty.id);

        await setScore(minusTwenty.id, -18);
        await refresh();
        expect((await statsOf(alice))?.worstRivalryId).toBe(minusNineteen.id);
      });

      it('best going to -1 is removed; worst going to +1 is removed', async () => {
        const best = await seedRivalry(bob, 5);
        const worst = await seedRivalry(carol, -5);
        await createStatsRow(app.db, {
          userId: alice.id,
          tournamentId: tournament.id,
          bestRivalryId: best.id,
          worstRivalryId: worst.id,
        });
        await setScore(best.id, -1);
        await setScore(worst.id, 1);
        await refresh();
        const aliceStats = await statsOf(alice);
        expect(aliceStats?.bestRivalryId).toBe(worst.id);
        expect(aliceStats?.worstRivalryId).toBe(best.id);

        await setScore(best.id, 0);
        await setScore(worst.id, 0);
        await refresh();
        const cleared = await statsOf(alice);
        expect(cleared?.bestRivalryId).toBeNull();
        expect(cleared?.worstRivalryId).toBeNull();
      });

      it('keeps the current selection on an equal-score tie', async () => {
        const first = await seedRivalry(bob, 10);
        await seedRivalry(carol, 10);
        await createStatsRow(app.db, {
          userId: alice.id,
          tournamentId: tournament.id,
          bestRivalryId: first.id,
        });
        await refresh();
        expect((await statsOf(alice))?.bestRivalryId).toBe(first.id);
      });
    });
  });
});
