import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { games, outcomes, stats, tournaments, users } from '../src/db/schema.js';
import {
  buildTestApp,
  createGameRow,
  createSport,
  createStatsRow,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

describe('test harness', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  it('factories create linked rows', async () => {
    const sport = await createSport(app.db, { name: 'babyfoot' });
    const alex = await createUser(app.db, { username: 'dev-alex' });
    const sam = await createUser(app.db, { username: 'dev-sam' });
    const tournament = await createTournament(app.db, {
      name: 'office',
      displayName: 'Office Cup',
      sportId: sport.id,
      ownerUserId: alex.id,
    });
    const alexStats = await createStatsRow(app.db, {
      userId: alex.id,
      tournamentId: tournament.id,
      score: 1016,
    });
    const { game, outcomes: rows } = await createGameRow(app.db, {
      tournamentId: tournament.id,
      outcomes: [
        { userId: alex.id, result: 'WIN', scoreValue: 16 },
        { userId: sam.id, result: 'LOSS', scoreValue: -16 },
      ],
    });

    expect(tournament.sportId).toBe(sport.id);
    expect(tournament.isOver).toBe(false);
    expect(alexStats).toMatchObject({
      score: 1016,
      bestScore: 1000,
      worstScore: 1000,
      gameCount: 0,
    });
    expect(game.tournamentId).toBe(tournament.id);
    expect(game.date).toBeInstanceOf(Date);
    expect(rows.map((r) => r.result).sort()).toEqual(['LOSS', 'WIN']);

    const [persisted] = await app.db
      .select({ n: count() })
      .from(outcomes)
      .where(eq(outcomes.gameId, game.id));
    expect(persisted?.n).toBe(2);
  });

  it('createTournament creates its own sport and owner when not given', async () => {
    const tournament = await createTournament(app.db);
    expect(tournament.sportId).toBeTruthy();
    expect(tournament.ownerUserId).toBeTruthy();
  });

  it('truncateAll leaves every table empty between tests', async () => {
    for (const table of [users, tournaments, games, outcomes, stats]) {
      const [row] = await app.db.select({ n: count() }).from(table);
      expect(row?.n).toBe(0);
    }
  });

  it('enforces unique (user, tournament) on stats', async () => {
    const tournament = await createTournament(app.db);
    const user = await createUser(app.db);
    await createStatsRow(app.db, { userId: user.id, tournamentId: tournament.id });
    await expect(
      createStatsRow(app.db, { userId: user.id, tournamentId: tournament.id }),
    ).rejects.toThrow();
  });
});
