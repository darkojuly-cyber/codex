import { expect, test } from '@playwright/test';

test('restores sign-in before showing login, retries temporary outages, survives browser reopening and honors logout', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter as SUPER ADMIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out →', exact: true })).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/session', async route => { await pending; await route.continue(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status')).toHaveText('Restoring your sign-in…');
  await expect(page.getByRole('button', { name: 'Enter as SUPER ADMIN', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in with Discord', exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: 'Sign out →', exact: true })).toBeVisible();
  await page.unroute('**/api/session');

  await page.route('**/api/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Unable to check your sign-in');
  await expect(page.getByRole('link', { name: 'Sign in with Discord', exact: true })).toHaveCount(0);
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Retry sign-in check', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out →', exact: true })).toBeVisible();

  const context = await browser.newContext({ baseURL: 'http://localhost:5173', storageState: await page.context().storageState() });
  try {
    const reopened = await context.newPage();
    await reopened.goto('/');
    await expect(reopened.getByRole('button', { name: 'Sign out →', exact: true })).toBeVisible();
    await reopened.getByRole('button', { name: 'Sign out →', exact: true }).click();
    await expect(reopened.getByRole('button', { name: 'Enter as SUPER ADMIN', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Enter as SUPER ADMIN', exact: true })).toBeVisible();
  } finally { await context.close(); }
});
