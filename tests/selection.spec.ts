import { test, expect } from './helpers/project.js';
import type { Page } from '@playwright/test';

const selected = (page: Page) => page.locator('.ag-row[aria-selected="true"]').evaluateAll(rows => rows.map(row => row.getAttribute('row-id')).sort());

for (const width of [1600, 420]) test(`鼠标单选、多选与范围勾选经过真实表格同步 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 800 });
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  const cell = (id: string) => page.locator(`[row-id="${id}"] [col-id="order"]`);
  await cell(a!).click(); await expect.poll(() => selected(page)).toEqual([a]);
  await cell(b!).click(); await expect.poll(() => selected(page)).toEqual([b]);
  await cell(a!).click({ modifiers: ['Control'] }); await expect.poll(() => selected(page)).toEqual([a, b].sort());
  await cell(b!).click({ modifiers: ['Control'] }); await expect.poll(() => selected(page)).toEqual([a]);
  await cell(c!).click({ modifiers: ['Meta'] }); await expect.poll(() => selected(page)).toEqual([a, c].sort());
  await cell(a!).click(); await cell(c!).click({ modifiers: ['Shift'] });
  await expect.poll(() => selected(page)).toEqual([a, b, c].sort());
  await page.keyboard.press('Escape'); await expect.poll(() => selected(page)).toEqual([]);
  const outgoing = page.waitForResponse(response => response.url().endsWith('/api/table-selection') && response.request().postDataJSON().ids.length === 1);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  expect((await outgoing).ok()).toBe(true);
  expect((await outgoing).request().postDataJSON().ids).toEqual([a]);
  await expect(page.locator('.ag-header input[type="checkbox"]')).toHaveJSProperty('indeterminate', true);
  await page.locator('.ag-header input[type="checkbox"]').click(); await expect.poll(() => selected(page)).toEqual([a, b, c].sort());
  await page.locator('.ag-header input[type="checkbox"]').click(); await expect.poll(() => selected(page)).toEqual([]);
});

for (const width of [1600, 420]) test(`查找与勾选不改变全部范围或页头几何，菜单 Escape 分层 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 800 });
  const ids = await project.seed(['匹配 A', '不匹配 B', '其他 C']); await page.goto(project.url);
  const grid = page.locator('.segment-grid'); const before = await grid.boundingBox();
  await page.getByRole('button', { name: '查找', exact: true }).click();
  const search = page.getByLabel('查找文案', { exact: true }); await search.fill('匹配');
  await page.locator(`[row-id="${ids[0]}"] input[type="checkbox"]`).click();
  await page.locator(`[row-id="${ids[1]}"] input[type="checkbox"]`).click();
  await expect.poll(() => selected(page)).toEqual(ids.slice(0, 2).sort());
  const after = await grid.boundingBox(); expect(after!.y).toBe(before!.y); expect(after!.height).toBe(before!.height);
  await expect(page.locator('.ag-row[row-id]')).toHaveCount(3);
  for (const name of ['新增口播片段', '查找', '导出全片', '更多']) await expect(page.locator('header').getByRole('button', { name, exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(`[row-id="${ids[0]}"] [data-segment-script]`).click({ button: 'right' });
  await search.click(); await expect(page.getByRole('menu')).toHaveCount(0); await expect(search).toBeFocused();
  await page.locator(`[row-id="${ids[0]}"] [data-segment-script]`).click({ button: 'right' });
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => selected(page)).toEqual(ids.slice(0, 2).sort());
  await page.keyboard.press('Escape'); await expect.poll(() => selected(page)).toEqual([]);
  await expect(search).toHaveValue('匹配');
  await search.press('Escape'); await expect(search).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查找', exact: true })).toBeFocused();
});

test('详情导航勾选目标，历史及编辑键盘保留表格上下文', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [col-id="order"]`).click();
  await page.getByRole('button', { name: '查看片段 2 的详情', exact: true }).click();
  await expect.poll(() => selected(page)).toEqual([b]); await page.keyboard.press('Escape');
  await page.getByLabel('片段 2 配音更多操作', { exact: true }).click(); await page.locator('[data-speech-history]').click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect.poll(() => selected(page)).toEqual([b]);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect.poll(() => selected(page)).toEqual([b]);
  await page.locator(`[row-id="${b}"] [role="status"]`).click(); await expect.poll(() => selected(page)).toEqual([b]);
  await page.locator(`[row-id="${b}"] [col-id="order"]`).click(); await page.keyboard.press('ArrowUp');
  await expect(page.locator(`[row-id="${a}"] [col-id="order"]`)).toBeFocused(); await expect.poll(() => selected(page)).toEqual([b]);
  const text = page.locator(`[row-id="${a}"] [col-id="text"]`);
  for (const key of ['F2', 'Enter']) {
    await text.focus(); await page.keyboard.press(key);
    await expect(page.getByLabel('文案全文', { exact: true })).toBeEditable();
    await page.keyboard.press('Escape'); await expect(page.getByLabel('文案全文', { exact: true })).toHaveCount(0);
    await expect.poll(() => selected(page)).toEqual([b]);
  }
});

test('真实勾选连接关闭后清空选择，恢复连接与同步失败均不沿用旧范围', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  const response = page.waitForResponse(r => r.url().endsWith('/api/table-selection') && r.request().postDataJSON().ids.includes(a));
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  const tableId = (await response).request().postDataJSON().tableId as string;
  const released = await fetch(`${project.url}/api/table-session/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId }) });
  expect(released.ok).toBe(true);
  await expect(page.locator('footer')).toContainText('勾选连接已断开'); await expect.poll(() => selected(page)).toEqual([]);
  const connected = page.waitForResponse(response => response.url().endsWith('/api/table-session'));
  await page.locator('footer [role="alert"] button').click(); expect((await connected).ok()).toBe(true); await expect(page.locator('footer [role="alert"] button')).toHaveCount(0);
  await page.route('**/api/table-selection', route => route.fulfill({ status: 500, json: { error: '本例同步失败' } }));
  await page.locator(`[row-id="${b}"] input[type="checkbox"]`).click();
  await expect(page.locator('footer [role="alert"] button')).toBeVisible(); await expect.poll(() => selected(page)).toEqual([]);
  await page.unroute('**/api/table-selection'); const reconnected = page.waitForResponse(response => response.url().endsWith('/api/table-session')); await page.locator('footer [role="alert"] button').click();
  expect((await reconnected).ok()).toBe(true); await expect(page.locator('footer [role="alert"] button')).toHaveCount(0);
  await page.locator(`[row-id="${b}"] input[type="checkbox"]`).click(); await expect.poll(() => selected(page)).toEqual([b]);
});

import { beginEdit } from '../src/shared/client.js';

test('多选禁用相对插入，动态外部修改权禁用全部菜单项并保留退出焦点', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click(); await page.locator(`[row-id="${b}"] input[type="checkbox"]`).click();
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '上方添加', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menuitem', { name: '下方添加', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => selected(page)).toEqual([a, b].sort());
  await page.keyboard.press('Home'); await expect(page.getByRole('menuitem', { name: '删除口播片段', exact: true })).toBeFocused();
  const edit = await beginEdit(project.url);
  try {
    for (const item of await page.getByRole('menuitem').all()) await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menu')).toBeFocused();
    await expect(page.locator(`[row-id="${a}"] [aria-label^="拖动片段 "]`)).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
    await expect.poll(() => selected(page)).toEqual([a, b].sort());
  } finally { await edit.close(); }
});

test('文案编辑器保留系统右键菜单并禁止拖拽', async ({ page, project }) => {
  const [a] = await project.seed(['A']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click();
  const editor = page.getByLabel('文案全文', { exact: true }); await expect(editor).toBeEditable();
  await expect(page.locator(`[row-id="${a}"] [aria-label^="拖动片段 "]`)).toBeDisabled();
  await page.evaluate(() => document.addEventListener('contextmenu', event => {
    queueMicrotask(() => { document.body.dataset.nativeContext = `${(event.target as Element).tagName}:${event.defaultPrevented}`; });
  }, { once: true, capture: true }));
  await editor.click({ button: 'right' }); await expect(page.locator('body')).toHaveAttribute('data-native-context', 'TEXTAREA:false');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('查找和部分勾选仍提交全片导出，不附加局部范围', async ({ page, project }) => {
  const [a] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  await page.getByRole('button', { name: '查找', exact: true }).click(); await page.getByLabel('查找文案', { exact: true }).fill('A');
  const request = page.waitForRequest(r => r.url().endsWith('/api/exports/submit'));
  await page.getByRole('button', { name: '导出全片', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({});
  await expect.poll(() => selected(page)).toEqual([a]);
  expect((await project.status()).snapshot.segments.map(s => s.text)).toEqual(['A', 'B', 'C']);
});

test('外部删除已选片段后只剪除失效身份并重新同步剩余范围', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  await page.locator(`[row-id="${b}"] input[type="checkbox"]`).click();
  const initial = page.waitForResponse(response => response.url().endsWith('/api/table-selection') && response.request().postDataJSON().ids.length === 2);
  await page.locator(`[row-id="${c}"] input[type="checkbox"]`).click(); expect((await initial).ok()).toBe(true);
  await expect.poll(() => selected(page)).toEqual([b, c].sort());
  const synchronized = page.waitForResponse(response => response.url().endsWith('/api/table-selection') && JSON.stringify(response.request().postDataJSON().ids) === JSON.stringify([b]));
  await project.modify({ changes: [{ kind: 'delete', expected: (await project.status()).snapshot.segments.find(segment => segment.id === c)! }] });
  await expect(page.locator(`[row-id="${c}"]`)).toHaveCount(0);
  await expect.poll(() => selected(page)).toEqual([b]); expect((await synchronized).ok()).toBe(true);
  expect((await synchronized).request().postDataJSON().ids).toEqual([b]);
  expect((await project.status()).snapshot.segments.map(segment => segment.id)).toEqual([a, b]);
});
