import { test, expect, GROUP_ID } from './fixtures.js';
import { API_URL } from '../apps/backend/e2e/environment.js';

test('members see private group data; outsiders cannot @smoke', async ({ signIn }) => {
  const member = await signIn('dev-jordan');
  await member.page.goto(`/groups/${GROUP_ID}`);
  await expect(member.page.getByTestId('group-name')).toHaveText('Shark Tank');
  await expect(member.page.getByTestId('group-member-dev-sam')).toBeVisible();
  await expect(member.page.getByTestId('group-player-guest-robin')).toBeVisible();
  await expect(member.page.getByRole('button', { name: 'Invite people', exact: true })).toHaveCount(
    0,
  );

  const outsider = await signIn('dev-taylor');
  await outsider.page.goto(`/groups/${GROUP_ID}`);
  await expect(
    outsider.page.getByText("This group doesn't exist or you can't see it.", { exact: true }),
  ).toBeVisible();
  await expect(outsider.page.getByTestId('group-screen')).toHaveCount(0);
  await outsider.page.goto('/tournament/sharktankcup');
  await expect(
    outsider.page.getByText("This tournament doesn't exist or you can't see it.", { exact: true }),
  ).toBeVisible();
});

test('removal evicts previously loaded group, tournament, and feed data', async ({
  signIn,
  request,
}) => {
  const owner = await signIn('dev-alex');
  const member = await signIn('dev-jordan');
  await member.page.goto('/feed');
  await expect(member.page.getByTestId('feed-list')).toContainText('Shark Tank Cup');
  await member.page.getByRole('tab', { name: 'Settings' }).click();
  await member.page.getByRole('button', { name: 'Groups', exact: true }).click();
  await member.page.getByRole('button', { name: /Shark Tank/ }).click();
  await expect(member.page.getByTestId('group-player-guest-robin')).toBeVisible();
  await member.page.getByRole('button', { name: 'Open Shark Tank Cup', exact: true }).click();
  await expect(member.page.getByTestId('tournament-list')).toBeVisible();
  await member.page.goBack();
  await member.page.getByRole('button', { name: 'Manage members', exact: true }).click();
  await expect(member.page.getByTestId('member-dev-jordan')).toBeVisible();

  const removed = await request.delete(
    `${API_URL}/groups/${GROUP_ID}/members/${member.session.user.id}`,
    {
      headers: { authorization: `Bearer ${owner.session.accessToken}` },
    },
  );
  expect(removed.status()).toBe(204);
  // Navigation focus is the app's refetch trigger; a reload would discard the caches under test.
  await member.page.goBack();
  await expect(
    member.page.getByText("This group doesn't exist or you can't see it.", { exact: true }),
  ).toBeVisible();
  await expect(member.page.getByTestId('group-player-guest-robin')).toHaveCount(0);
  const feedTab = member.page.getByRole('tab', { name: 'Feed', exact: true });
  for (let i = 0; i < 5 && !(await feedTab.isVisible()); i++) await member.page.goBack();
  await feedTab.click();
  await expect(member.page.getByTestId('feed-list')).toBeVisible();
  await expect(member.page.getByTestId('feed-list')).not.toContainText('Shark Tank Cup');
  await member.page.getByRole('tab', { name: 'Tournaments', exact: true }).click();
  await expect(member.page.getByTestId('tournaments-list')).toBeVisible();
  await expect(member.page.getByTestId('tournament-row-sharktankcup')).toHaveCount(0);
});
