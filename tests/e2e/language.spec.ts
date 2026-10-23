import { test, expect } from '@playwright/test';

test.use({ locale: 'zh-CN' });

test('Chinese and English switching persists, preserves drafts, and sends unchanged protocol values', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const language = page.getByRole('combobox', { name: '语言 / Language' });
  await expect(language).toHaveValue('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page).toHaveTitle('EvoMeme 社区运营后台');
  await page.getByRole('button', { name: /进入后台.*超级管理员/ }).click();
  await expect(page.getByRole('heading', { name: '社区动态，一目了然。' })).toBeVisible();
  for (const name of ['概览', '工单', '消息中心', 'Mimo 与灵感机', '运营阶段', '设置', '审计日志']) {
    await expect(page.getByRole('navigation').getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/overview-zh-CN.png', fullPage: true });
  await language.selectOption('en');
  await expect(page.getByRole('heading', { name: 'Your community, at a glance.' })).toBeVisible();
  await page.reload();
  await expect(language).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('navigation').getByRole('button', { name: 'Messaging', exact: true }).click();
  const authored = 'Do not translate my draft: 你好 {user} <tag>';
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(authored);
  await language.selectOption('zh-CN');
  await expect(page.getByRole('textbox', { name: '消息正文', exact: true })).toHaveValue(authored);
  await page.getByRole('textbox', { name: '频道 ID', exact: true }).fill('923456789012345678');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('该频道尚未获准发布');
  await expect(page.getByRole('alert')).toContainText('CHANNEL_NOT_APPROVED');
  const welcome = 'Keep this Discord welcome in English: {user}';
  await page.getByRole('navigation').getByRole('button', { name: 'Mimo 与灵感机', exact: true }).click();
  await page.getByRole('textbox', { name: /欢迎语模板/ }).fill(welcome);
  // Switching language must retain authored copy and unsaved form state.
  await language.selectOption('en');
  await expect(page.getByRole('textbox', { name: /Welcome template/ })).toHaveValue(welcome);
  const personaRequest = page.waitForRequest(request => request.url().endsWith('/api/config/drafts') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Save configuration draft', exact: true }).click();
  expect((await personaRequest).postDataJSON().persona.welcome).toBe(welcome);
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await language.selectOption('zh-CN');
  await expect(page.getByRole('status')).toContainText('草稿已保存');
  await page.getByRole('navigation').getByRole('button', { name: '运营阶段', exact: true }).click();
  await page.getByLabel('当前运营阶段').selectOption('WEB_LIVE');
  const phaseRequest = page.waitForRequest(request => request.url().endsWith('/api/config/drafts') && request.method() === 'POST');
  await page.getByRole('button', { name: '校验并保存草稿', exact: true }).click();
  expect((await phaseRequest).postDataJSON().phase).toBe('WEB_LIVE');
  await expect(page.getByRole('status')).toContainText('草稿已保存');
  await page.getByRole('navigation').getByRole('button', { name: '概览', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(language).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/overview-zh-CN-mobile.png', fullPage: true });
  await page.reload();
  await expect(language).toHaveValue('zh-CN');
  expect(errors).toEqual([]);
});

test('language switching stays usable when localStorage is unavailable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  await page.goto('/');
  const language = page.getByRole('combobox', { name: '语言 / Language' });
  await expect(language).toHaveValue('zh-CN');
  await language.selectOption('en');
  await expect(page.getByRole('heading', { name: /A little weird/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(errors).toEqual([]);
});
