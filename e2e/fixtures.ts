import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { resetFixtures } from '../apps/backend/e2e/database.js';
import { API_URL, DEV_AUTH, WEB_URL } from '../apps/backend/e2e/environment.js';
import type { SessionResponse } from '../apps/mobile/src/api/types.js';

export { expect };
export const GROUP_ID = '5ea0c0de-0000-4000-8000-000000000001';

export const test = base.extend<{
  seed: void;
  signIn: (
    username: string,
  ) => Promise<{ context: BrowserContext; page: Page; session: SessionResponse }>;
}>({
  seed: [
    // Playwright requires object destructuring even when this fixture has no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await resetFixtures();
      await use();
    },
    { auto: true },
  ],
  signIn: async ({ browser, request }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async (username) => {
      const response = await request.post(`${API_URL}/auth/dev-token`, {
        headers: { 'x-dev-auth': DEV_AUTH },
        data: { username },
      });
      expect(response.status()).toBe(200);
      const session: SessionResponse = await response.json();
      const context = await browser.newContext({
        storageState: {
          cookies: [],
          origins: [
            {
              origin: WEB_URL,
              localStorage: [{ name: 'sharkulator.session', value: JSON.stringify(session) }],
            },
          ],
        },
      });
      contexts.push(context);
      return { context, page: await context.newPage(), session };
    });
    for (const [index, context] of contexts.entries()) {
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = testInfo.outputPath(`user-${index}.png`);
        const page = context.pages()[0];
        if (page) {
          await page.screenshot({ path: screenshot });
          await testInfo.attach(`user-${index}`, { path: screenshot, contentType: 'image/png' });
        }
      }
      await context.close();
    }
  },
});

export async function pickTournament(page: Page, displayName = 'Office Babyfoot') {
  await page.getByTestId('game-form-edit-tournament').click();
  // The game form header behind the picker shows the same row, so scope to the picker.
  await page
    .getByTestId('tournament-picker-list')
    .getByRole('button', { name: `Open ${displayName}`, exact: true })
    .first()
    .click();
  await expect(page.getByTestId('game-form-tournament')).toContainText(displayName);
}
