import { test, expect, pickTournament } from './fixtures.js';
import { API_URL } from '../apps/backend/e2e/environment.js';

test('winner QR payload submits a game and refreshes both feeds', async ({ signIn, request }) => {
  const winner = await signIn('dev-alex');
  const loser = await signIn('dev-sam');
  // Keep the winner's feed mounted so returning to it exercises live invalidation/focus.
  await winner.page.goto('/feed');
  await expect(winner.page.getByTestId('feed-list')).toBeVisible();
  await winner.page.getByRole('tab', { name: 'Add Game' }).click();
  await winner.page.getByRole('button', { name: 'WON', exact: true }).click();
  await pickTournament(winner.page);
  const payload = await winner.page.getByTestId('qr-payload').innerText();
  expect(JSON.parse(payload)).toMatchObject({ username: 'dev-alex', result: 'WIN' });

  await loser.page.goto('/add-game');
  await loser.page.getByRole('button', { name: 'LOST', exact: true }).click();
  await pickTournament(loser.page);
  await expect(loser.page.getByTestId('scanner-all-good')).toBeDisabled();
  await loser.page.getByRole('textbox', { name: 'QR code payload' }).fill(payload);
  await loser.page.getByRole('button', { name: 'Add code', exact: true }).click();
  await expect(loser.page.getByTestId('scanned-outcomes')).toContainText('dev-alex');
  await loser.page.getByTestId('scanner-all-good').click();
  const saved = loser.page.waitForResponse(
    (r) =>
      r.url() === `${API_URL}/tournaments/officebabyfoot/games` && r.request().method() === 'POST',
  );
  await loser.page.getByRole('button', { name: 'Submit', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const game = await response.json();
  await expect(loser.page.getByTestId(`game-detail-${game.id}`)).toBeVisible();
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
  await winner.page.goBack();
  await winner.page.getByRole('tab', { name: 'Feed', exact: true }).click();
  await expect(winner.page.getByTestId(`game-row-${game.id}`)).toBeVisible();
});
