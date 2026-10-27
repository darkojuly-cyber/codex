import { expect, test } from '@playwright/test';

test('shows collection coverage, resolves nicknames and lets only super admins authorize staff and configure risk hints', async ({ page, browser }) => {
  const member = '833456789012345678';
  await page.route('**/api/members/resolve', async route => { const response = await route.fetch(); const data = await response.json(); data.entries = data.entries.map((entry: { user_id: string }) => entry.user_id === member ? { ...entry, display_name: 'Studio Helper', username: 'studio-helper' } : entry); await route.fulfill({ response, json: data }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter as SUPER ADMIN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Community activity', exact: true })).toBeVisible();
  await expect(page.getByText('Not collecting yet', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lifecycle', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Weekly points leaders', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Active phase', exact: true })).toBeVisible();
  await expect(page.getByLabel('Help-desk panel channel ID', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: /^Staff access$/ }).click();
  page.on('dialog', dialog => dialog.accept());
  await page.getByLabel('Staff Discord user ID', { exact: false }).fill(member);
  await page.getByRole('combobox', { name: 'Authorized role', exact: true }).selectOption('MODERATOR');
  await page.getByLabel('Authorization reason', { exact: true }).fill('Allow this team member to moderate support and review risks');
  await page.getByRole('button', { name: 'Save staff authorization', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Staff authorization saved');
  const row = page.locator('.revision').filter({ has: page.getByText(member, { exact: true }) });
  await expect(row.getByText('Studio Helper', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Edit authorization', exact: true }).click();
  await page.getByLabel('Revoke console access', { exact: true }).check();
  await page.getByLabel('Authorization reason', { exact: true }).fill('Remove access after the test assignment has finished');
  await page.getByRole('button', { name: 'Save staff authorization', exact: true }).click();
  await expect(row).toContainText('Access revoked');
  expect((await (await page.request.get('/api/staff')).json()).entries.find((item: { user_id: string }) => item.user_id === member).revision).toBe(2);

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Configure keyword monitoring$/ }).click();
  await page.getByLabel('Public channel IDs (comma separated)', { exact: true }).fill('933456789012345678');
  await page.getByLabel('Keywords (one per line)', { exact: true }).fill('scam\n诈骗');
  await page.getByLabel('Enable keyword monitoring', { exact: true }).check();
  await page.getByRole('button', { name: 'Save monitoring settings', exact: true }).click();
  await expect(page.getByText('Keyword monitoring enabled', { exact: true })).toBeVisible();
  const snapshot = await (await page.request.get('/api/operations')).json();
  expect(snapshot.monitoring.body).toMatchObject({ enabled: true, keywords: ['scam','诈骗'], channelIds: ['933456789012345678'] });
  expect(snapshot.coverage).toBeNull();
  await page.getByLabel('语言 / Language').selectOption('zh-CN');
  await page.screenshot({ path: 'test-results/operations-overview-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/operations-overview-mobile.png', fullPage: true });
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  try {
    const moderator = await context.newPage(); await moderator.goto('/');
    await moderator.getByRole('button', { name: 'Enter as MODERATOR', exact: true }).click();
    await expect(moderator.getByRole('heading', { name: 'Community activity', exact: true })).toBeVisible();
    expect((await moderator.request.get('/api/staff')).status()).toBe(403);
    await expect(moderator.getByText('Configure keyword monitoring', { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
