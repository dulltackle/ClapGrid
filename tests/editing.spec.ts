import { test, expect } from './helpers/project.js';

test('文案通过真实服务保存并在重载后保留', async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.goto(project.url);
  await page.locator(`[row-id="${id}"] [data-segment-script]`).click();
  await page.getByLabel('文案全文', { exact: true }).fill('已保存的新文案');
  await page.getByLabel('文案全文', { exact: true }).press('Enter');
  await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  await page.reload();
  await expect(page.locator(`[row-id="${id}"] .text-summary`)).toHaveText('已保存的新文案');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('已保存的新文案');
});

import { holdResponse } from './helpers/response-gate.js';

test('行内 Escape 取消且 Shift+Enter 保留多行输入', async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.goto(project.url);
  const cell = page.locator(`[row-id="${id}"] [data-segment-script]`);
  const input = page.getByLabel('文案全文', { exact: true });
  await cell.click(); await input.fill('取消的草稿'); await input.press('Escape');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原文');
  await cell.click(); await input.fill('第一行'); await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  // 浏览器不提供系统 IME 原语：这里只验证 editor 的 composition 兼容事件。
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await input.press('Enter');
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe('第一行\n第二行');
});

test('相邻单击等待原行保存后进入新行，连接先关闭仍显示保存成功', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']);
  await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click();
  await page.getByLabel('文案全文', { exact: true }).fill('A 新文案');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await page.locator(`[row-id="${b}"] [data-segment-script]`).click();
    await gate.received;
    await expect(page.locator('[data-save-status]')).toContainText('保存中');
    expect((await project.status()).snapshot.segments[0]!.text).toBe('A 新文案');
  } finally { gate.release(); }
  await gate.delivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveValue('B');
  await expect(page.getByLabel('文案全文', { exact: true })).toBeFocused();
  await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  expect(gate.calls).toBe(1);
});

test('真实页面关闭最终释放编辑修改权', async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  await page.locator('[data-segment-script]').click();
  await expect(page.getByLabel('文案全文', { exact: true })).toBeEditable();
  expect((await project.status()).modification?.owner).toBe('user');
  await page.close();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
});
