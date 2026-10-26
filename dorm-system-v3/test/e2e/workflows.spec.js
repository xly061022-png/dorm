import { test, expect } from '@playwright/test';

async function login(page, username = 'admin') {
  await page.goto('/');
  await page.locator('#login-form [name=username]').fill(username);
  await page.locator('#login-form [name=password]').fill('E2e-Password-1234');
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('#app-view')).toBeVisible();
}

test('login errors, HttpOnly session, reload persistence and logout', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#login-form [name=username]').fill('admin');
  await page.locator('#login-form [name=password]').fill('wrong');
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('#login-error')).toContainText('账号或密码错误');
  await login(page);
  const cookie = (await context.cookies()).find((c) => c.name === 'dorm_session');
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain('dorm_session');
  const response = await page.request.get('/api/me');
  expect(Object.keys(await response.json())).toEqual(['user']);
  await page.reload();
  await expect(page.locator('#app-view')).toBeVisible();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.locator('#login-view')).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('history pagination, page size and details use real API', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await expect(page.locator('#history-body tr')).toHaveCount(10);
  const first = await page.locator('#history-body').innerText();
  await page.locator('#history-pager').getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('#history-body tr')).toHaveCount(5);
  expect(await page.locator('#history-body').innerText()).not.toEqual(first);
  await expect(page.locator('#history-pager')).toContainText('第 2 / 2 页');
  await page.locator('#history-pager').getByLabel('每页条数').selectOption('20');
  await expect(page.locator('#history-body tr')).toHaveCount(15);
  await page
    .locator('#history-body')
    .getByRole('button', { name: '详情', exact: true })
    .first()
    .click();
  await expect(page.locator('#detail-dialog')).toBeVisible();
  await expect(page.locator('#detail-content')).toContainText('90分');
  await expect(page.locator('#detail-content img')).toBeVisible();
});

test('missing dorm pagination, last page and direct inspection', async ({ page }) => {
  await login(page, 'checker');
  await expect(page.locator('#admin-tab')).toBeHidden();
  await page.getByRole('button', { name: '未查宿舍', exact: true }).click();
  await expect(page.locator('#missing-body tr')).toHaveCount(10);
  const first = await page.locator('#missing-body').innerText();
  await page.locator('#missing-pager').getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('#missing-pager')).toContainText('第 2 /');
  expect(await page.locator('#missing-body').innerText()).not.toEqual(first);
  await page.locator('#missing-pager').getByRole('button', { name: '末页' }).click();
  await expect(
    page.locator('#missing-pager').getByRole('button', { name: '下一页' }),
  ).toBeDisabled();
  await page.locator('#missing-body').getByRole('button', { name: '去打分' }).first().click();
  await expect(page.locator('#view-inspect')).toBeVisible();
  await expect(page.locator('#dorm-select')).not.toHaveValue('');
});

test('upload, create, edit and delete inspection in browser', async ({ page }) => {
  await login(page);
  // A small PNG captured from the browser supplies a valid, decodable file fixture.
  const image = await page.screenshot({ clip: { x: 0, y: 0, width: 30, height: 30 } });
  await page.getByRole('button', { name: '未查宿舍', exact: true }).click();
  await page.locator('#missing-body').getByRole('button', { name: '去打分' }).first().click();
  await page.locator('#inspection-date').fill('2026-10-25');
  await page.locator('#inspector').fill('浏览器完整流程');
  for (let i = 0; i < 10; i++) await page.locator(`#score-${i}`).fill('9');
  await page
    .locator('#photo-0')
    .setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('#photo-preview-0 img')).toBeVisible();
  await page.locator('#save-inspection').click();
  await expect(page.locator('#notice')).toContainText('检查记录已保存');
  let row = page.locator('#history-body tr').filter({ hasText: '浏览器完整流程' });
  await expect(row).toContainText('90分');
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#score-0').fill('5');
  await page.locator('#save-inspection').click();
  row = page.locator('#history-body tr').filter({ hasText: '浏览器完整流程' });
  await expect(row).toContainText('86分');
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('记录已删除');
  await expect(row).toHaveCount(0);
});

test('mobile viewport remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'checker');
  await page.getByRole('button', { name: '未查宿舍', exact: true }).click();
  await expect(page.locator('#missing-body tr')).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('admin imports dorm CSV; completed dorms disappear from dropdown by week and history stays editable', async ({
  page,
  browser,
}) => {
  await login(page);
  await expect(page.locator('.brand')).toContainText('电子信息工程学院');
  await page.getByRole('button', { name: '系统管理', exact: true }).click();
  const content =
    '年级,校区,楼栋,宿舍号,性别,班级\r\n2027级,新校区,测试新楼,001,女,电信新生1班\r\n';
  await page
    .locator('#dorm-import-file')
    .setInputFiles({ name: '新生名单.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
  await page.locator('#preview-dorm-import').click();
  await expect(page.locator('#dorm-import-summary')).toContainText('新增1条');
  await page.locator('#confirm-dorm-import').click();
  await expect(page.locator('#dorm-import-summary')).toContainText('导入完成');
  await page.locator('#preview-dorm-import').click();
  await expect(page.locator('#dorm-import-summary')).toContainText('跳过重复1条');
  await expect(page.locator('#confirm-dorm-import')).toBeDisabled();
  await page.getByRole('button', { name: '现场检查', exact: true }).click();
  await page.locator('#dorm-grade').selectOption('2027级');
  await page.locator('#dorm-gender').selectOption('女');
  await page.locator('#dorm-building').selectOption('测试新楼');
  await page.locator('#dorm-select').selectOption({ index: 1 });
  const dormId = await page.locator('#dorm-select').inputValue();
  await page.locator('#inspection-date').fill('2026-10-25');
  await page.locator('#inspection-week').selectOption('7');
  await expect(page.locator('#dorm-select')).toBeEnabled();
  await page.locator('#inspector').fill('新生宿舍测试');
  const image = await page.screenshot({ clip: { x: 0, y: 0, width: 30, height: 30 } });
  await page
    .locator('#photo-0')
    .setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('#photo-preview-0 img')).toBeVisible();
  await page.locator('#save-inspection').click();
  await expect(page.locator('#notice')).toContainText('检查记录已保存');
  await page.getByRole('button', { name: '现场检查', exact: true }).click();
  const item = page.locator(`#dorm-select option[value="${dormId}"]`);
  await expect(item).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新检查状态' })).toHaveCount(0);
  await page.locator('#inspection-week').selectOption('8');
  await expect(item).toHaveCount(1);
  await page.locator('#inspection-week').selectOption('7');
  await expect(item).toHaveCount(0);
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  const row = page.locator('#history-body tr').filter({ hasText: '新生宿舍测试' });
  page.on('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#score-0').fill('10');
  await page.locator('#save-inspection').click();
  await expect(row).toContainText('10分');
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: '现场检查', exact: true }).click();
  await expect(item).toHaveCount(1);
  await expect(page.locator('#dorm-select')).toBeEnabled();
  const context = await browser.newContext();
  const checker = await context.newPage();
  await login(checker, 'checker');
  const denied = await checker.request.post('/api/admin/dorms/import', { data: { content } });
  expect(denied.status()).toBe(403);
  await context.close();
});

test('administrator edits dorm details; history and CSV retain original labels', async ({
  page,
  browser,
}) => {
  await login(page);
  const records = await (await page.request.get('/api/records?period=1&pageSize=1')).json();
  const record = records.items[0];
  await page.getByRole('button', { name: '系统管理', exact: true }).click();
  await page.locator('#dorm-search').fill(record.dorm);
  await page.getByRole('button', { name: '查询宿舍', exact: true }).click();
  const row = page.locator(`#dorms-body tr[data-dorm-id="${record.dorm_id}"]`);
  await row.getByRole('button', { name: '编辑宿舍' }).click();
  await page.locator('#dorm-edit-form [name=className]').fill('修改后的班级');
  await page.locator('#dorm-edit-form [name=dorm]').fill('0099');
  await page.getByRole('button', { name: '保存宿舍信息', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('宿舍信息已更新');
  await page.locator('#dorm-search').fill('0099');
  await page.getByRole('button', { name: '查询宿舍', exact: true }).click();
  await expect(row).toContainText('修改后的班级');
  const details = await (await page.request.get('/api/records/' + record.id)).json();
  expect(details.dorm).toBe(record.dorm);
  expect(details.className).toBe(record.className);
  const csv = await (await page.request.get('/api/export?period=1')).text();
  expect(csv).not.toContain('修改后的班级');
  const boot = await (await page.request.get('/api/bootstrap')).json();
  expect(boot.dorms.find((d) => d.id === record.dorm_id).dorm).toBe('0099');
  const context = await browser.newContext();
  const checker = await context.newPage();
  await login(checker, 'checker');
  expect(
    (await checker.request.put('/api/admin/dorms/' + record.dorm_id, { data: {} })).status(),
  ).toBe(403);
  await context.close();
});
