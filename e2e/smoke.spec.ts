import { test, expect } from './fixtures.js';

test('UI dev sign-in, session reload, and logout @smoke', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Dev username' }).fill('dev-alex');
  await page.getByRole('button', { name: 'Dev sign in', exact: true }).click();
  await expect(page.getByTestId('feed-list')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('feed-list')).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Signed in as dev-alex', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  // Logging out asks first; the confirmation has its own Log out button.
  await page
    .getByTestId('confirm-dialog')
    .getByRole('button', { name: 'Log out', exact: true })
    .click();
  await expect(page.getByTestId('dev-sign-in')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('sharkulator.session')))
    .toBeNull();
});

test('feed opens a saved game and its tournament @smoke', async ({ signIn }) => {
  const { page } = await signIn('dev-alex');
  await page.goto('/feed');
  const row = page.getByTestId(/^game-row-/).first();
  await expect(row).toBeVisible();
  const id = (await row.getAttribute('data-testid'))!.replace('game-row-', '');
  await row.click();
  await expect(page.getByTestId(`game-detail-${id}`)).toBeVisible();
  await expect(page.getByTestId('game-detail-outcomes')).toContainText('dev-alex');
  await expect(page.getByTestId('game-detail-rivalry')).toBeVisible();
  await page.getByRole('link', { name: /^Open tournament / }).click();
  await expect(page.getByTestId('tournament-list')).toBeVisible();
});

test('tournament search opens ranking and history @smoke', async ({ signIn }) => {
  const { page } = await signIn('dev-sam');
  await page.goto('/tournaments');
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('Office Babyfoot');
  await expect(page.getByTestId('tournaments-list').getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open Office Babyfoot', exact: true }).click();
  await expect(page.getByTestId('tournament-list')).toBeVisible();
  await expect(page.getByText('RANKING', { exact: true })).toBeVisible();
  await expect(page.getByTestId(/^game-row-/).first()).toBeVisible();
});
