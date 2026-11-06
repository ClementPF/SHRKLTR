import { test, expect, pickTournament } from './fixtures.js';
import { API_URL } from '../apps/backend/e2e/environment.js';

test('winner QR payload submits a game and refreshes both feeds', async ({ signIn, request }) => {
  const winner = await signIn('dev-alex');
  const loser = await signIn('dev-sam');
  // Keep the winner's feed mounted so returning to it exercises live invalidation/focus.
  await winner.page.goto('/feed');
  await expect(winner.page.getByTestId('feed-list')).toBeVisible();
  await winner.page.getByRole('tab', { name: 'Add game' }).click();
  await winner.page.getByRole('button', { name: 'Won', exact: true }).click();
  await pickTournament(winner.page);
  const payload = await winner.page.getByTestId('qr-payload').innerText();
  expect(JSON.parse(payload)).toMatchObject({ username: 'dev-alex', result: 'WIN' });

  await loser.page.goto('/add-game');
  await loser.page.getByRole('button', { name: 'Lost', exact: true }).click();
  await pickTournament(loser.page);
  // The loser screen uses the same header as every pushed screen.
  await expect(loser.page.getByRole('link', { name: 'Go back', exact: true })).toBeVisible();
  await expect(loser.page.getByTestId('scanner-review-game')).toBeDisabled();
  await loser.page.getByRole('textbox', { name: 'QR code payload' }).fill(payload);
  await loser.page.getByRole('button', { name: 'Add code', exact: true }).click();
  // Complete teams open the confirmation on their own.
  await expect(loser.page.getByTestId('game-confirmation-outcomes-winners')).toContainText(
    'dev-alex',
  );
  const saved = loser.page.waitForResponse(
    (r) =>
      r.url() === `${API_URL}/tournaments/officebabyfoot/games` && r.request().method() === 'POST',
  );
  await loser.page.getByRole('button', { name: 'Confirm game', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const game = await response.json();
  await expect(loser.page.getByTestId(`game-detail-${game.id}`)).toBeVisible();
  // The game is saved: no way back into the form it came from.
  await expect(loser.page.getByRole('link', { name: 'Go back', exact: true })).toHaveCount(0);
  await expect(loser.page.getByTestId('outcome-dev-sam')).toContainText('LOSS');
  await expect(loser.page.getByTestId('outcome-dev-alex')).toContainText('WIN');
  const read = await request.get(`${API_URL}/games/${game.id}`, {
    headers: { authorization: `Bearer ${loser.session.accessToken}` },
  });
  expect(read.status()).toBe(200);
  const persisted = await read.json();
  expect(persisted.outcomes).toHaveLength(2);
  expect(
    persisted.outcomes.reduce((sum: number, o: { scoreValue: number }) => sum + o.scoreValue, 0),
  ).toBe(0);
  await loser.page.getByRole('button', { name: 'Back to feed', exact: true }).click();
  await expect(loser.page.getByTestId(`game-row-${game.id}`)).toBeVisible();
  await winner.page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(winner.page.getByRole('tab', { name: 'Feed', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(winner.page.getByTestId(`game-row-${game.id}`)).toBeVisible();
});

test('team game: a teammate shows their code and one loser submits for everyone', async ({
  signIn,
}) => {
  const payloadOf = async (username: string, side: 'Won' | 'Lost') => {
    const { page } = await signIn(username);
    await page.goto('/add-game');
    await page.getByRole('button', { name: side, exact: true }).click();
    await pickTournament(page);
    if (side === 'Lost') {
      await page.getByRole('tab', { name: 'Teammate submits', exact: true }).click();
      await expect(page.getByTestId('scanner-teammate-text')).toBeVisible();
      // A teammate only shows a code: they cannot submit or add anyone themselves.
      await expect(page.getByTestId('scanner-review-game')).toHaveCount(0);
      await expect(page.getByTestId('manual-code-entry')).toHaveCount(0);
    }
    return page.getByTestId('qr-payload').innerText();
  };
  // The teammate goes first so the teams stay incomplete until the last winner is scanned.
  const codes = [
    await payloadOf('dev-jordan', 'Lost'),
    await payloadOf('dev-alex', 'Won'),
    await payloadOf('dev-taylor', 'Won'),
  ];
  expect(JSON.parse(codes[0]!)).toMatchObject({ username: 'dev-jordan', result: 'LOSS' });

  const submitter = await signIn('dev-sam');
  await submitter.page.goto('/add-game');
  await submitter.page.getByRole('button', { name: 'Lost', exact: true }).click();
  await pickTournament(submitter.page);
  await expect(
    submitter.page.getByRole('tab', { name: "I'll submit", exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  // Adding players without their QR code is disabled.
  await expect(submitter.page.getByTestId('add-players')).toHaveCount(0);
  for (const code of codes) {
    await submitter.page.getByRole('textbox', { name: 'QR code payload' }).fill(code);
    await submitter.page.getByRole('button', { name: 'Add code', exact: true }).click();
  }
  await expect(submitter.page.getByTestId('game-confirmation-outcomes-winners')).toContainText(
    'dev-taylor',
  );
  await expect(submitter.page.getByTestId('game-confirmation-outcomes-losers')).toContainText(
    'dev-jordan',
  );
  const saved = submitter.page.waitForResponse(
    (r) =>
      r.url() === `${API_URL}/tournaments/officebabyfoot/games` && r.request().method() === 'POST',
  );
  await submitter.page.getByRole('button', { name: 'Confirm game', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const game = await response.json();
  expect(game.outcomes).toHaveLength(4);
  await expect(submitter.page.getByTestId('outcome-dev-jordan')).toContainText('LOSS');
  await expect(submitter.page.getByTestId('outcome-dev-taylor')).toContainText('WIN');
});
