import { test, expect } from './helpers/project.js';
import { holdRequest } from './helpers/response-gate.js';

test('普通片段弹窗从真实虚拟卸载来源返回并继续表格方向键', async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 80 }, (_, i) => `文案 ${i}`));
  await page.setViewportSize({ width: 420, height: 420 });
  await page.goto(project.url);
  await page.locator('.ag-grid-viewport').evaluate(node => { node.scrollLeft = node.scrollWidth; });
  const more = page.getByLabel('片段 1 配音更多操作', { exact: true });
  await more.focus();
  await more.press('Enter');
  await page.locator('[data-speech-history]').click();
  const history = page.getByRole('dialog', { name: '配音详情与保留音频', exact: true });
  await expect(history).toBeVisible();
  // 安排真实 AG Grid 虚拟卸载；不是用 DOM 替身代替表格。
  await page.locator('.ag-grid-viewport').evaluate(node => { node.scrollLeft = 0; node.scrollTop = node.scrollHeight; });
  await expect(page.locator(`[row-id="${ids[0]}"] [col-id="noteToggle"]`)).toHaveCount(0);
  await history.getByRole('button', { name: '关闭', exact: true }).click();
  const origin = page.locator(`[row-id="${ids[0]}"] [col-id="noteToggle"]`);
  await expect(origin).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`[row-id="${ids[1]}"] [col-id="noteToggle"]`)).toBeFocused();
  expect((await project.status()).snapshot.segments.map(s => s.text)).toEqual(Array.from({ length: 80 }, (_, i) => `文案 ${i}`));
});

test('父详情与子弹窗各自保留来源，新查找取消子返回后父层仍可正常关闭', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B', 'C']);
  await page.goto(project.url);
  const origin = page.locator(`[row-id="${a}"] [data-row-details]`);
  await origin.press('Enter');
  const parent = page.getByRole('complementary', { name: '口播片段详情', exact: true });
  await parent.getByRole('button', { name: '保留音频', exact: true }).click();
  const history = page.getByRole('dialog', { name: '配音详情与保留音频', exact: true });
  await expect(history).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  // 已检查可见状态；暂停帧时跳过稳定帧等待，仍由真实鼠标完成关闭。
  await history.getByRole('button', { name: '关闭', exact: true }).click({ force: true });
  await expect(history).toHaveCount(0);
  await page.getByRole('button', { name: '查找', exact: true }).click({ force: true });
  const search = page.getByLabel('查找文案', { exact: true });
  await search.fill('B');
  await page.clock.runFor(100);
  await expect(search).toBeFocused();
  await expect(parent).toBeVisible();
  await page.clock.resume();
  await search.press('Escape');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(origin).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`[row-id="${b}"] [role="gridcell"]:focus`)).toHaveCount(1);
});

test('详情关闭在外部重排、删除与空表后采用稳定身份及当前显示位置', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']);
  await page.goto(project.url);
  const open = async (id: string) => page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  const close = () => page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await open(a!);
  await project.modify({ changes: [{ kind: 'reorder', expectedIds: [a!, b!, c!], ids: [b!, c!, a!] }] });
  // 状态轮询到达真实表格后才关闭，避免把数据同步等待误认成焦点故障。
  await expect(page.locator(`[row-id="${a}"]`)).toHaveAttribute('row-index', '2');
  await close();
  await expect(page.locator(`[row-id="${a}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(`[row-id="${c}"] [role="gridcell"]:focus`)).toHaveCount(1);
  await open(c!);
  const before = (await project.status()).snapshot.segments;
  await project.modify({ changes: [{ kind: 'delete', expected: before.find(s => s.id === c)! }] });
  await expect(page.locator(`[row-id="${c}"]`)).toHaveCount(0);
  await close();
  await expect(page.locator(`[row-id="${a}"] [data-row-details]`)).toBeFocused();
  await open(a!);
  await project.modify({ changes: (await project.status()).snapshot.segments.map(expected => ({ kind: 'delete' as const, expected })) });
  await expect(page.locator('.ag-row[row-id]')).toHaveCount(0);
  await close();
  await expect(page.getByRole('button', { name: '查找', exact: true })).toBeFocused();
});

test('旧子弹窗返回不穿透新详情的模态层，新流程连续关闭后仍回新来源', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']);
  await page.goto(project.url);
  const parent = page.getByRole('complementary', { name: '口播片段详情', exact: true });
  const history = page.getByRole('dialog', { name: '配音详情与保留音频', exact: true });
  await page.locator(`[row-id="${a}"] [data-row-details]`).press('Enter');
  await parent.getByRole('button', { name: '保留音频', exact: true }).click();
  await expect(history).toBeVisible();
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await history.getByRole('button', { name: '关闭', exact: true }).click({ force: true });
  await expect(history).toHaveCount(0);
  await page.getByRole('button', { name: '查找', exact: true }).click({ force: true });
  const search = page.getByLabel('查找文案', { exact: true });
  await search.fill('新条件');
  await page.locator(`[row-id="${b}"] [data-row-details]`).press('Enter');
  await expect(parent.getByLabel('详情文案', { exact: true })).toHaveValue('B');
  await parent.getByRole('button', { name: '保留音频', exact: true }).click({ force: true });
  await expect(history).toBeVisible();
  await page.clock.runFor(100);
  await expect.poll(() => history.evaluate(node => node.contains(document.activeElement))).toBe(true);
  // 模态层开启时父抽屉从可访问树隐藏；这里只读取保留数据，不尝试穿透操作。
  await expect(page.locator('aside[aria-label="口播片段详情"] [aria-label="详情文案"]')).toHaveValue('B');
  await expect(search).toHaveValue('新条件');
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([a, b, c]);
  await history.getByRole('button', { name: '关闭', exact: true }).click({ force: true });
  await page.clock.runFor(100); await page.clock.resume();
  await search.press('Escape');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${b}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`[row-id="${c}"] [role="gridcell"]:focus`)).toHaveCount(1);
});

test('成功导航后初始聚焦帧让位于新查找，已提交的新来源仍可正常关闭', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']);
  await page.goto(project.url);
  const parent = page.getByRole('complementary', { name: '口播片段详情', exact: true });
  await page.locator(`[row-id="${a}"] [data-row-details]`).press('Enter');
  await expect(parent).toBeFocused();
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.locator(`[row-id="${b}"] [data-row-details]`).press('Enter');
  // 数据已切到 B，但精确聚焦帧尚未执行；这与未提交的保存/租约导航不同。
  await expect(parent.getByLabel('详情文案', { exact: true })).toHaveValue('B');
  await expect(parent).not.toBeFocused();
  await page.getByRole('button', { name: '查找', exact: true }).press('Enter');
  const search = page.getByLabel('查找文案', { exact: true });
  await search.fill('新条件');
  await page.clock.runFor(100);
  await expect(search).toBeFocused(); await expect(search).toHaveValue('新条件');
  await search.press('Escape');
  // 保持查找关闭的聚焦帧待执行，再用真实鼠标关闭可见详情，固定两个返回意图的竞态。
  await expect(page.getByRole('button', { name: '关闭详情', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click({ force: true });
  await page.clock.runFor(100); await page.clock.resume();
  await expect(page.locator(`[row-id="${b}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`[row-id="${c}"] [role="gridcell"]:focus`)).toHaveCount(1);
});

test('申请修改权忙态拒绝新的详情导航，迟到连接取消后仍保留原来源', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']);
  await page.goto(project.url);
  const parent = page.getByRole('complementary', { name: '口播片段详情', exact: true });
  await page.locator(`[row-id="${a}"] [data-row-details]`).press('Enter');
  await expect(parent).toBeFocused();
  const input = parent.getByLabel('详情文案', { exact: true });
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await input.click(); await gate.received;
    await expect(input).toBeDisabled();
    await page.locator(`[row-id="${b}"] [data-row-details]`).press('Enter');
    await expect(input).toHaveValue('A');
  } finally { gate.release(); }
  await gate.answered;
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await expect(input).toBeEnabled(); await expect(input).toHaveAttribute('readonly', '');
  await expect(input).toHaveValue('A');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${a}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`[row-id="${b}"] [role="gridcell"]:focus`)).toHaveCount(1);
});
