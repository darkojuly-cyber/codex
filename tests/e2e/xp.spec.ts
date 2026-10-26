import { test, expect } from '@playwright/test';

test('creates a reviewable Evo Points proposal and keeps scoring paused until explicitly changed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter as SUPER ADMIN' }).click();
  await page.getByRole('button', { name: 'XP & Rewards', exact: true }).click();
  const creation = page.locator('.xp-rule').filter({ has: page.locator('summary').filter({ hasText: 'Creation' }) });
  await creation.locator('summary').click();
  await creation.getByLabel('XP per award').fill('15');
  await creation.getByLabel('Daily XP cap').fill('15');
  await page.getByLabel('Reason for rule change').fill('Legacy reward configuration fixture');
  await page.getByRole('button', { name: 'Save XP rules draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('XP draft saved');
  await page.getByRole('button', { name: 'Approve XP rules', exact: true }).click();
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Publish XP rules', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('XP rules published');
  const old = await (await page.request.get('/api/xp/config')).json();
  expect(old.current.body.rules.find((rule: {event: string}) => rule.event === 'creation').points).toBe(15);
  await page.getByRole('button', { name: 'Create Evo Points draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Evo Points draft created');
  await expect(page.getByLabel('Enable XP scoring', { exact: true })).not.toBeChecked();
  await expect(creation.getByLabel('XP per award')).toHaveValue('5');
  await expect(creation.getByLabel('Daily XP cap')).toHaveValue('20');
  const staged = await (await page.request.get('/api/xp/config')).json();
  expect(staged.current.version).toBe(old.current.version);
  expect(staged.current.body).toEqual(old.current.body);
  await page.getByRole('button', { name: 'Approve XP rules', exact: true }).click();
  await page.getByRole('button', { name: 'Publish XP rules', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('XP rules published');
  const result = await (await page.request.get('/api/xp/rules')).json();
  expect(result.body.enabled).toBe(false);
  expect(result.body.rules.find((rule: {event: string}) => rule.event === 'creation').points).toBe(5);
  expect(result.body.rules.find((rule: {event: string}) => rule.event === 'confirmed_issue').dailyCap).toBe(18);
});

test('staff can review XP rules, award a contribution once and inspect bilingual ledger and rankings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter as SUPER ADMIN' }).click();
  await page.getByRole('button', { name: 'XP & Rewards', exact: true }).click();
  await expect(page.getByText('Scoring disabled', { exact: true })).toBeVisible();
  await page.getByLabel('Enable XP scoring', { exact: true }).check();
  const creation = page.locator('.xp-rule').filter({ has: page.locator('summary').filter({ hasText: 'Creation' }) });
  await creation.locator('summary').click();
  await creation.getByLabel('Enable this rule').check();
  await page.getByLabel('Reason for rule change').fill('Reviewed E2E contribution rewards');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'XP & Rewards', exact: true }).click();
  await expect(page.getByLabel('Enable XP scoring', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Save XP rules draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('XP draft saved');
  await page.getByRole('button', { name: 'Approve XP rules', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('XP rules approved');
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Publish XP rules', exact: true }).click();
  await expect(page.getByText('Scoring enabled', { exact: true })).toBeVisible();

  const adjustment = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Manual XP adjustment', exact: true }) });
  await adjustment.getByLabel('Discord user ID').fill('123456789012345678');
  await adjustment.getByLabel('XP amount').fill('25');
  await adjustment.getByLabel('Reason', { exact: true }).fill('Reviewed correction for browser acceptance');
  await adjustment.getByRole('button', { name: 'Record adjustment', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('XP adjustment recorded');

  const reviewed = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Reviewed contribution', exact: true }) });
  await reviewed.getByLabel('Unique source ID').fill('creation:e2e:first');
  await reviewed.getByLabel('Review reason').fill('Verified an original game creation');
  await reviewed.getByRole('button', { name: 'Award reviewed contribution', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Contribution XP awarded');
  await reviewed.getByRole('button', { name: 'Award reviewed contribution', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('DUPLICATE_EVENT');
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('all_time');
  await page.getByRole('button', { name: 'Load leaderboard' }).click();
  await expect(page.getByText('#1 · 123456789012345678 · 30 XP', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/xp-desktop.png', fullPage: true });

  await page.getByLabel('语言 / Language').selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '积分流水', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/xp-mobile.png', fullPage: true });
});

test('Support cannot access XP management', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter as SUPPORT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your community, at a glance.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'XP & Rewards', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/xp/config')).status()).toBe(403);
  expect((await page.request.get('/api/xp/me')).status()).toBe(200);
});
