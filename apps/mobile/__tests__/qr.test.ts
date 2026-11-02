import {
  INVALID_QR_MESSAGE,
  REQUIRED_KEYS,
  WRONG_TOURNAMENT_MESSAGE,
  applyScan,
  buildQrPayload,
  encodeQrPayload,
  isRepeatedScan,
  parseQrPayload,
  seedOutcomes,
  submissionBlocker,
  toSubmitGameRequest,
} from '@/lib/qr';

const winnerCode = (username: string, tournamentName = 'officebabyfoot') =>
  encodeQrPayload(buildQrPayload(username, tournamentName, 'WIN'));
const loserCode = (username: string, tournamentName = 'officebabyfoot') =>
  encodeQrPayload(buildQrPayload(username, tournamentName, 'LOSS'));

describe('buildQrPayload / encodeQrPayload', () => {
  it('builds the legacy payload shape exactly', () => {
    expect(buildQrPayload('dev-alex', 'officebabyfoot', 'WIN')).toStrictEqual({
      username: 'dev-alex',
      tournamentName: 'officebabyfoot',
      tournament: { name: 'officebabyfoot' },
      result: 'WIN',
    });
  });

  it('encodes as JSON with a stable key order', () => {
    expect(winnerCode('dev-alex')).toBe(
      '{"username":"dev-alex","tournamentName":"officebabyfoot","tournament":{"name":"officebabyfoot"},"result":"WIN"}',
    );
    expect(JSON.parse(loserCode('dev-sam'))).toStrictEqual({
      username: 'dev-sam',
      tournamentName: 'officebabyfoot',
      tournament: { name: 'officebabyfoot' },
      result: 'LOSS',
    });
  });
});

describe('parseQrPayload', () => {
  it('round-trips an encoded payload', () => {
    expect(parseQrPayload(winnerCode('dev-alex'))).toStrictEqual({
      ok: true,
      payload: buildQrPayload('dev-alex', 'officebabyfoot', 'WIN'),
    });
  });

  it('requires the username, result and tournamentName keys', () => {
    expect(REQUIRED_KEYS).toStrictEqual(['username', 'result', 'tournamentName']);
    for (const key of REQUIRED_KEYS) {
      const payload: Record<string, unknown> = { ...buildQrPayload('a', 't', 'WIN') };
      delete payload[key];
      expect(parseQrPayload(JSON.stringify(payload))).toStrictEqual({
        ok: false,
        error: INVALID_QR_MESSAGE,
      });
    }
  });

  it.each([
    ['not json', 'https://example.com'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a number username', '{"username":1,"result":"WIN","tournamentName":"t"}'],
    ['an empty username', '{"username":" ","result":"WIN","tournamentName":"t"}'],
    ['a TIE result', '{"username":"a","result":"TIE","tournamentName":"t"}'],
    [
      'a malformed tournament',
      '{"username":"a","result":"WIN","tournamentName":"t","tournament":"t"}',
    ],
  ])('rejects %s', (_label, raw) => {
    expect(parseQrPayload(raw)).toStrictEqual({ ok: false, error: INVALID_QR_MESSAGE });
  });

  it('fills the nested tournament when an older code omits it', () => {
    expect(parseQrPayload('{"username":"a","result":"LOSS","tournamentName":"t"}')).toStrictEqual({
      ok: true,
      payload: buildQrPayload('a', 't', 'LOSS'),
    });
  });
});

describe('multi-scan accumulation', () => {
  it('seeds the outcomes with the scanning player as a loser', () => {
    expect(seedOutcomes('dev-sam')).toStrictEqual([{ username: 'dev-sam', result: 'LOSS' }]);
  });

  it('adds a scanned winner to the seeded outcomes', () => {
    const scan = applyScan(seedOutcomes('dev-sam'), winnerCode('dev-alex'), 'officebabyfoot');
    expect(scan).toStrictEqual({
      status: 'added',
      added: { username: 'dev-alex', result: 'WIN' },
      outcomes: [
        { username: 'dev-sam', result: 'LOSS' },
        { username: 'dev-alex', result: 'WIN' },
      ],
    });
  });

  it('accumulates several scans for team games, winners and team-mate losers alike', () => {
    let outcomes = seedOutcomes('dev-sam');
    for (const code of [
      winnerCode('dev-alex'),
      loserCode('dev-jordan'),
      winnerCode('dev-taylor'),
    ]) {
      const scan = applyScan(outcomes, code, 'officebabyfoot');
      expect(scan.status).toBe('added');
      outcomes = scan.outcomes;
    }
    expect(outcomes).toStrictEqual([
      { username: 'dev-sam', result: 'LOSS' },
      { username: 'dev-alex', result: 'WIN' },
      { username: 'dev-jordan', result: 'LOSS' },
      { username: 'dev-taylor', result: 'WIN' },
    ]);
  });

  it('ignores a username that was already scanned, including the scanning player', () => {
    const first = applyScan(seedOutcomes('dev-sam'), winnerCode('dev-alex'), 'officebabyfoot');
    const again = applyScan(first.outcomes, loserCode('dev-alex'), 'officebabyfoot');
    expect(again.status).toBe('duplicate');
    expect(again.outcomes).toBe(first.outcomes);
    const self = applyScan(first.outcomes, winnerCode('dev-sam'), 'officebabyfoot');
    expect(self.status).toBe('duplicate');
    expect(self.outcomes).toBe(first.outcomes);
  });

  it('rejects a code from another tournament without changing the outcomes', () => {
    const outcomes = seedOutcomes('dev-sam');
    expect(
      applyScan(outcomes, winnerCode('dev-alex', 'lunchdarts'), 'officebabyfoot'),
    ).toStrictEqual({
      status: 'wrong-tournament',
      error: WRONG_TOURNAMENT_MESSAGE,
      outcomes,
    });
  });

  it('rejects a code whose nested tournament disagrees with tournamentName', () => {
    const raw = JSON.stringify({
      username: 'dev-alex',
      tournamentName: 'officebabyfoot',
      tournament: { name: 'lunchdarts' },
      result: 'WIN',
    });
    expect(applyScan(seedOutcomes('dev-sam'), raw, 'officebabyfoot').status).toBe(
      'wrong-tournament',
    );
  });

  it('rejects an invalid code without changing the outcomes', () => {
    const outcomes = seedOutcomes('dev-sam');
    expect(applyScan(outcomes, 'garbage', 'officebabyfoot')).toStrictEqual({
      status: 'invalid',
      error: INVALID_QR_MESSAGE,
      outcomes,
    });
  });
});

describe('confirmation gate', () => {
  it('blocks submission until a winner was scanned', () => {
    expect(submissionBlocker(seedOutcomes('dev-sam'))).toBe(
      "Scan the winner's QR code before submitting.",
    );
  });

  it('blocks submission while the teams have different sizes', () => {
    const outcomes = [
      { username: 'dev-sam', result: 'LOSS' as const },
      { username: 'dev-alex', result: 'WIN' as const },
      { username: 'dev-taylor', result: 'WIN' as const },
    ];
    expect(submissionBlocker(outcomes)).toBe(
      'Teams must have the same size (2 winners vs 1 loser). Scan the missing players.',
    );
  });

  it('allows a 1v1 and an even team game', () => {
    const one = applyScan(seedOutcomes('dev-sam'), winnerCode('dev-alex'), 'officebabyfoot');
    expect(submissionBlocker(one.outcomes)).toBeNull();
    const team = [
      ...one.outcomes,
      { username: 'dev-jordan', result: 'LOSS' as const },
      { username: 'dev-taylor', result: 'WIN' as const },
    ];
    expect(submissionBlocker(team)).toBeNull();
  });

  it('maps the outcomes to the submit request body', () => {
    const one = applyScan(seedOutcomes('dev-sam'), winnerCode('dev-alex'), 'officebabyfoot');
    expect(toSubmitGameRequest(one.outcomes)).toStrictEqual({
      outcomes: [
        { username: 'dev-sam', result: 'LOSS' },
        { username: 'dev-alex', result: 'WIN' },
      ],
    });
  });
});

describe('isRepeatedScan', () => {
  it('treats the same code within the window as a repeat of the camera frame', () => {
    expect(isRepeatedScan(null, 'a', 1000)).toBe(false);
    expect(isRepeatedScan({ data: 'a', at: 1000 }, 'a', 2500)).toBe(true);
    expect(isRepeatedScan({ data: 'a', at: 1000 }, 'a', 3001)).toBe(false);
    expect(isRepeatedScan({ data: 'a', at: 1000 }, 'b', 1001)).toBe(false);
  });
});
