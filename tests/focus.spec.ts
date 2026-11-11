import { test, expect } from './helpers/project.js';
import { holdRequest } from './helpers/response-gate.js';

test('普通片段弹窗从真实虚拟卸载来源返回配音菜单', async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 80 }, (_, i) => `文案 ${i}`));
  await page.setViewportSize({ width: 420, height: 420 });
  await page.goto(project.url);
  await page.locator('.ag-grid-viewport').evaluate(node => { node.scrollLeft = node.scrollWidth; });
  const more = page.getByLabel('片段 1 配音更多操作', { exact: true });
  await more.focus();
  await more.press('Enter');
  await page.getByRole('menuitem', { name: '配音记录与保留音频', exact: true }).click();
  const history = page.getByRole('dialog', { name: '配音详情与保留音频', exact: true });
  await expect(history).toBeVisible();
  // 安排真实 AG Grid 虚拟卸载；不是用 DOM 替身代替表格。
  await page.locator('.ag-grid-viewport').evaluate(node => { node.scrollLeft = 0; node.scrollTop = node.scrollHeight; });
  await expect(page.locator(`[row-id="${ids[0]}"] [col-id="text"]`)).toHaveCount(0);
  await history.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '配音记录与保留音频', exact: true })).toBeVisible();
  expect((await project.status()).snapshot.segments.map(s => s.text)).toEqual(Array.from({ length: 80 }, (_, i) => `文案 ${i}`));
});


test('历史弹窗关闭按稳定身份处理重排、删除与空表', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  const open = async (order: number) => {
    await page.getByRole('button', { name: `片段 ${order} 配音更多操作`, exact: true }).press('Enter');
    await page.getByRole('menuitem', { name: '配音记录与保留音频', exact: true }).press('Enter');
  };
  const close = () => page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await open(1);
  await project.modify({ changes: [{ kind: 'reorder', expectedIds: [a!, b!, c!], ids: [b!, c!, a!] }] });
  await expect(page.locator(`[row-id="${a}"]`)).toHaveAttribute('row-index', '2');
  await close(); await expect(page.locator(`[row-id="${a}"]`).getByRole('button', { name: '片段 3 配音更多操作' })).toBeFocused();
  await open(2);
  await project.modify({ changes: [{ kind: 'delete', expected: (await project.status()).snapshot.segments[1]! }] });
  await expect(page.locator(`[row-id="${c}"]`)).toHaveCount(0);
  await close(); await expect(page.locator(`[row-id="${a}"] [col-id="text"]`)).toBeFocused();
  await open(2);
  await project.modify({ changes: (await project.status()).snapshot.segments.map(expected => ({ kind: 'delete' as const, expected })) });
  await expect(page.locator('.ag-row[row-id]')).toHaveCount(0);
  await close(); await expect(page.getByRole('button', { name: '查找', exact: true })).toBeFocused();
});

test('历史关闭的待返回帧让位于新查找与新弹窗', async ({ page, project }) => {
  await project.seed(['A', 'B']); await page.goto(project.url);
  const open = async (order: number) => {
    await page.getByRole('button', { name: `片段 ${order} 配音更多操作`, exact: true }).press('Enter');
    await page.getByRole('menuitem', { name: '配音记录与保留音频', exact: true }).press('Enter');
  };
  await open(1);
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click({ force: true });
  await page.getByRole('button', { name: '查找', exact: true }).click({ force: true });
  const search = page.getByLabel('查找文案', { exact: true }); await search.fill('B');
  await page.clock.runFor(100); await expect(search).toBeFocused();
  await open(2); await page.clock.runFor(100);
  await expect.poll(() => page.getByRole('dialog', { name: '配音详情与保留音频', exact: true }).evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.clock.resume();
});
