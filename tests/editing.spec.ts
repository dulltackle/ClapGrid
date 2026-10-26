import { test, expect } from './helpers/project.js';

test('文案通过真实服务保存并在重载后保留', async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.goto(project.url);
  await page.locator(`[row-id="${id}"] [data-segment-script]`).dblclick();
  await page.getByLabel('文案全文', { exact: true }).fill('已保存的新文案');
  await page.getByLabel('文案全文', { exact: true }).press('Control+Enter');
  await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  await page.reload();
  await expect(page.locator(`[row-id="${id}"] .text-summary`)).toHaveText('已保存的新文案');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('已保存的新文案');
});

import { holdResponse } from './helpers/response-gate.js';

for (const width of [780, 420]) test(`原位编辑保留行高、画面上下文和内嵌操作 ${width}`, async ({ page, project }) => {
  const [id, next] = await project.seed(['原文', '下一条']);
  const snapshot = (await project.status()).snapshot;
  await project.modify({ changes: [{ kind: 'edit', expected: snapshot.segments[0]!, visualNote: '保留画面说明' }] });
  await page.setViewportSize({ width, height: 579 });
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  await row.locator('[data-segment-script]').dblclick();
  const editor = row.locator('[data-inline-editor]');
  const input = page.getByLabel('文案全文', { exact: true });
  await expect(row).toHaveCSS('height', '102px');
  await expect(editor.locator('[data-segment-support]')).toContainText('保留画面说明');
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeVisible();
  await expect.poll(async () => {
    const bounds = (await editor.boundingBox())!, support = (await editor.locator('[data-segment-support]').boundingBox())!;
    return bounds.height <= 102 && support.y + support.height <= bounds.y + bounds.height + 1;
  }).toBe(true);
  await expect(input).toHaveCSS('outline-style', 'none');
  await expect.poll(async () => {
    const current = (await row.boundingBox())!, following = (await page.locator(`[row-id="${next}"]`).boundingBox())!;
    return following.y >= current.y + current.height - 1;
  }).toBe(true);
  await input.fill('第一行'); await input.press('Enter'); await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe('第一行\n第二行');
  await expect(row).toHaveCSS('height', '102px');
  await row.locator('[data-segment-script]').dblclick();
  await input.fill('不保存的草稿');
  await editor.getByRole('button', { name: '取消修改', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('第一行\n第二行');
});

for (const [width, height] of [[780, 579], [420, 360]]) test(`原位放大缩小保留草稿、焦点与修改权 ${width}×${height}`, async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.setViewportSize({ width: width!, height: height! });
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  await row.locator('[data-segment-script]').dblclick();
  const input = page.getByLabel('文案全文', { exact: true });
  const expand = row.getByRole('button', { name: '放大编辑', exact: true });
  await input.fill('原位草稿');
  const box = (await row.locator('[data-inline-text-box]').boundingBox())!;
  const button = (await expand.boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width);
  expect(button.y).toBeGreaterThanOrEqual(box.y);
  await expand.click();
  const dialog = page.getByRole('dialog', { name: '编辑口播文案 · 片段 1', exact: true });
  const large = page.getByLabel('放大文案全文', { exact: true });
  await expect(dialog).toBeVisible(); await expect(large).toBeFocused();
  await expect(large).toHaveValue('原位草稿');
  await large.press('Tab');
  await expect(dialog.getByRole('button', { name: '取消修改', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(large).toBeFocused();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原文');
  expect((await project.status()).modification?.owner).toBe('user');
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width! + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height! + 1);
  await large.fill('放大后修改\n第二行');
  await dialog.getByRole('button', { name: '缩小编辑', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(input).toBeFocused();
  await expect(input).toHaveValue('放大后修改\n第二行');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原文');
  await expand.click(); await expect(large).toBeFocused();
  await large.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(input).toBeFocused();
  await expect(input).toHaveValue('放大后修改\n第二行');
  await expand.click(); await expect(large).toBeFocused();
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe('放大后修改\n第二行');
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await row.locator('[data-segment-script]').dblclick(); await input.fill('不保存的放大草稿'); await expand.click();
  await expect(large).toBeFocused();
  await dialog.getByRole('button', { name: '取消修改', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(input).toHaveCount(0);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('放大后修改\n第二行');
});

test('行内 Escape 取消且 Shift+Enter 保留多行输入', async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.goto(project.url);
  const cell = page.locator(`[row-id="${id}"] [data-segment-script]`);
  const input = page.getByLabel('文案全文', { exact: true });
  await cell.dblclick(); await input.fill('取消的草稿'); await input.press('Escape');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原文');
  await cell.dblclick(); await input.fill('第一行'); await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  // 浏览器不提供系统 IME 原语：这里只验证 editor 的 composition 兼容事件。
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await input.press('Control+Enter');
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe('第一行\n第二行');
});

test('相邻双击等待原行保存后进入新行，连接先关闭仍显示保存成功', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']);
  await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).dblclick();
  await page.getByLabel('文案全文', { exact: true }).fill('A 新文案');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await page.locator(`[row-id="${b}"] [data-segment-script]`).dblclick();
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
  await page.locator('[data-segment-script]').dblclick();
  await expect(page.getByLabel('文案全文', { exact: true })).toBeEditable();
  expect((await project.status()).modification?.owner).toBe('user');
  await page.close();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
});
