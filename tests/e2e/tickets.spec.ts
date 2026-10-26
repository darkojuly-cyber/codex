import { expect, test } from '@playwright/test';

test('handles a private ticket from submission through replies, issue points, close, reopen and Support assignment', async ({ page, browser }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter as SUPER ADMIN' }).click();
  const session = await (await page.request.get('/api/session')).json();
  const headers = { origin: 'http://localhost:5173', 'x-csrf-token': session.csrf };
  const create = async (userId: string, summary: string) => {
    const result = await page.request.post('/api/mock/ticket', { headers, data: { userId, requestKey: crypto.randomUUID(), input: { category: 'Bug', summary, description: 'The browser becomes blank after starting the game.', environment: 'Windows · Chrome' } } });
    expect(result.ok()).toBe(true); return result.json();
  };
  const ticket = await create('733456789012345678', 'Lifecycle browser acceptance');
  const unrelated = await create('744456789012345678', 'Private unrelated issue');
  const rules = await (await page.request.get('/api/xp/rules')).json();
  const draft = await (await page.request.post('/api/xp/drafts', { headers, data: { config: { ...rules.body, enabled: true }, reason: 'Approve confirmed issue rewards', expectedVersion: rules.version } })).json();
  await page.request.post(`/api/xp/${draft.id}/approve`, { headers, data: { expectedEditVersion: 1 } });
  await page.request.post(`/api/xp/${draft.id}/publish`, { headers, data: { expectedVersion: rules.version, expectedEditVersion: 1, confirm: true } });
  await page.getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.getByLabel('Search ticket number or summary').fill('Lifecycle browser acceptance');
  await page.getByRole('button', { name: 'Search tickets', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: `#${ticket.seq}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: new RegExp(`Ticket #${ticket.seq}`) })).toBeVisible();
  await dialog.getByRole('button', { name: 'Claim ticket', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Ticket updated');
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('WAITING_USER');
  await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('HIGH');
  await dialog.getByLabel('Reason / internal note').fill('PRIVATE browser investigation note');
  await dialog.getByRole('button', { name: 'Save status & note', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Ticket updated');
  await expect(dialog.getByText('PRIVATE browser investigation note', { exact: true })).toBeVisible();
  page.on('dialog', prompt => prompt.accept());
  const reply = 'Please send a screenshot and the browser version in this private channel.';
  await dialog.getByLabel('User-visible reply', { exact: true }).fill(reply);
  await dialog.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Reply queued');
  await expect.poll(async () => {
    const detail = await (await page.request.get(`/api/tickets/${ticket.id}`)).json();
    return detail.replies.find((item: { body: string }) => item.body === reply)?.status;
  }, { timeout: 15000, intervals: [500, 1000] }).toBe('SENT');
  await dialog.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
  await expect(dialog.getByText(reply, { exact: true })).toBeVisible();
  await dialog.getByLabel('Reason / internal note').fill('Confirmed unique reproducible browser issue');
  await dialog.getByRole('button', { name: 'Confirm unique issue & award points', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Issue points awarded once');
  await expect(dialog.getByRole('button', { name: 'Confirm unique issue & award points', exact: true })).toBeDisabled();
  const account = await (await page.request.get('/api/xp/members/733456789012345678')).json();
  expect(account.summary.lifetimeXp).toBe(3);
  for (const status of ['CLOSED', 'OPEN']) {
    await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption(status);
    await dialog.getByLabel('Reason / internal note').fill(`${status} during complete workflow acceptance`);
    await dialog.getByRole('button', { name: 'Save status & note', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Ticket updated');
    await expect.poll(async () => (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()).sync_status, { timeout: 15000 }).toBe('SYNCED');
  }
  await dialog.getByLabel('Assignee Discord user ID').fill('mock-support');
  await dialog.getByLabel('Reason / internal note').fill('Assign to the authorized support account');
  await dialog.getByRole('button', { name: 'Save status & note', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Ticket updated');
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  try {
    const support = await context.newPage();
    await support.goto('/');
    await support.getByRole('button', { name: 'Enter as SUPPORT', exact: true }).click();
    await support.getByRole('button', { name: 'Tickets', exact: true }).click();
    await expect(support.getByRole('button', { name: `#${ticket.seq}`, exact: true })).toBeVisible();
    expect((await support.request.get(`/api/tickets/${unrelated.id}`)).status()).toBe(404);
    await support.getByRole('button', { name: `#${ticket.seq}`, exact: true }).click();
    await expect(support.getByLabel('Assignee Discord user ID')).toBeDisabled();
    const latest = await (await support.request.get(`/api/tickets/${ticket.id}`)).json();
    const supportSession = await (await support.request.get('/api/session')).json();
    expect((await support.request.patch(`/api/tickets/${ticket.id}`, { headers: { origin: headers.origin, 'x-csrf-token': supportSession.csrf }, data: { status: 'OPEN', note: 'Cannot reassign another person', assignedTo: session.userId, expectedVersion: latest.revision } })).status()).toBe(403);
  } finally { await context.close(); }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('语言 / Language').selectOption('zh-CN');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: `#${ticket.seq}`, exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('原因 / 内部备注')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ticket-workflow-mobile.png', fullPage: true });
});
