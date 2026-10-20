import { test, expect } from './helpers/project.js';
import type { Page } from '@playwright/test';
import { beginEdit } from '../src/shared/client.js';
import { holdResponse } from './helpers/response-gate.js';

async function openDelete(page: Page, id: string, details = false) {
  await page.locator(`[row-id="${id}"] ${details ? '[data-row-details]' : '[data-segment-script]'}`).click({ button: 'right' });
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog', { name: '删除口播片段', exact: true })).toBeVisible();
}
const dialog = (page: Page) => page.getByRole('alertdialog', { name: '删除口播片段', exact: true });

for (const width of [1600, 420]) test(`行菜单固定选择范围，删除确认键盘取消与明确提交 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 800 });
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click(); await page.locator(`[row-id="${b}"] input[type="checkbox"]`).click();
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' });
  const menu = page.getByRole('menu'); await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(menu).toHaveCSS('border-top-color', 'rgb(227, 228, 231)');
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(dialog(page)).toContainText('2 个口播片段');
  const cancel = dialog(page).getByRole('button', { name: '取消', exact: true });
  const confirm = dialog(page).getByRole('button', { name: '删除', exact: true });
  await expect(cancel).toBeFocused(); await expect(cancel).toHaveCSS('border-top-style', 'solid');
  await expect(confirm).toHaveCSS('background-color', 'rgb(164, 38, 44)');
  for (const node of [cancel, confirm]) { await expect(node).toBeInViewport(); expect((await node.boundingBox())!.height).toBeGreaterThanOrEqual(32); }
  await page.keyboard.press('Tab'); await expect(confirm).toBeFocused();
  await expect(confirm).toHaveCSS('outline-color', 'rgb(8, 117, 209)');
  await page.keyboard.press('Tab'); await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(confirm).toBeFocused();
  await cancel.click(); await expect(dialog(page)).toHaveCount(0);
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([a, b, c]);
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(2);
  await openDelete(page, c!); await expect(dialog(page)).toContainText('确定删除这个口播片段');
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(`[row-id="${c}"]`)).toHaveAttribute('aria-selected', 'true');
  await openDelete(page, c!);
  const request = page.waitForRequest(r => r.url().endsWith('/api/segments/modify'));
  await dialog(page).getByRole('button', { name: '删除', exact: true }).click();
  expect((await request).postDataJSON().changes.map((change: { expected: { id: string } }) => change.expected.id)).toEqual([c]);
  await expect(page.locator(`[row-id="${c}"]`)).toHaveCount(0);
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([a, b]);
  await page.locator('.segment-grid').click({ button: 'right', position: { x: 5, y: 650 } });
  await expect(menu).toHaveCount(0);
});

for (const width of [1600, 420]) test(`右下边缘菜单全部导航键与 Space 交接可达 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 360 });
  await project.seed(Array.from({ length: 30 }, (_, i) => `片段 ${i + 1}`)); await page.goto(project.url);
  const viewport = page.locator('.ag-grid-viewport'); await viewport.hover(); await page.mouse.wheel(0, 500);
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const point = await viewport.evaluate(element => {
    const v = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll<HTMLElement>('[row-id]')].filter(row => { const r = row.getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom; });
    const row = rows.at(-1)!; const r = row.getBoundingClientRect();
    return { id: row.getAttribute('row-id')!, x: Math.min(innerWidth - 28, v.right - 28), y: r.bottom - 8, scroll: element.scrollTop };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByRole('menu'); await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(360);
  for (const [key, name] of [['End', '下方添加'], ['ArrowUp', '上方添加'], ['Home', '删除口播片段'], ['ArrowDown', '上方添加'], ['Home', '删除口播片段']]) {
    await page.keyboard.press(key!); await expect(page.getByRole('menuitem', { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Space'); await expect(dialog(page)).toBeVisible(); await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(`[row-id="${point.id}"] :focus`)).toHaveCount(1);
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(point.scroll);
});

test('删除提交固定旧快照，勾选断线与外部修改删除不扩大范围且逐项反馈', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  const synchronized = page.waitForResponse(response => response.url().endsWith('/api/table-selection') && response.request().postDataJSON().ids.length === 2);
  await page.locator(`[row-id="${b}"] input[type="checkbox"]`).click();
  const tableId = (await synchronized).request().postDataJSON().tableId as string;
  await openDelete(page, a!);
  const original = (await project.status()).snapshot.segments;
  const released = await fetch(`${project.url}/api/table-session/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId }) });
  expect(released.ok).toBe(true); await expect(page.locator('footer')).toContainText('勾选连接已断开');
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(0);
  await project.modify({ changes: [{ kind: 'edit', expected: original[0]!, text: '外部 A' }, { kind: 'delete', expected: original[1]! }] });
  await expect(page.locator(`[row-id="${a}"] .text-summary`)).toHaveText('外部 A'); await expect(page.locator(`[row-id="${b}"]`)).toHaveCount(0);
  await expect(dialog(page)).toContainText('2 个口播片段');
  const request = page.waitForRequest(r => r.url().endsWith('/api/segments/modify'));
  await dialog(page).getByRole('button', { name: '删除', exact: true }).click();
  expect((await request).postDataJSON().changes.map((change: { expected: unknown }) => change.expected)).toEqual(original.slice(0, 2));
  await expect(page.locator('footer')).toContainText('目标内容已变化'); await expect(page.locator('footer')).toContainText('口播片段已删除');
  expect((await project.status()).snapshot.segments.map(s => s.text)).toEqual(['外部 A', 'C']);
  expect(c).toBeTruthy();
});

test('外部真实修改权动态禁用确认并把焦点移到取消，解除前不提交', async ({ page, project }) => {
  const [a] = await project.seed(['A']); await page.goto(project.url); await openDelete(page, a!);
  const confirm = dialog(page).getByRole('button', { name: '删除', exact: true });
  await page.keyboard.press('Tab'); await expect(confirm).toBeFocused();
  const edit = await beginEdit(project.url);
  try {
    await expect(confirm).toBeDisabled(); await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await expect(confirm).toHaveCSS('opacity', '0.5');
    await page.keyboard.press('Enter'); await expect(dialog(page)).toHaveCount(0);
    expect((await project.status()).snapshot.segments).toHaveLength(1);
  } finally { await edit.close(); }
});

for (const unknown of [false, true]) test(`删除${unknown ? '已提交响应未知' : '明确失败'}不自动重试`, async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url); await openDelete(page, a!);
  let calls = 0;
  await page.route('**/api/segments/modify', async route => {
    calls++; if (unknown) { await route.fetch(); await route.abort('failed'); }
    else await route.fulfill({ status: 500, json: { error: '本例删除失败' } });
  });
  await dialog(page).getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); await expect(page.locator('[data-save-status]')).toHaveText('保存失败');
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual(unknown ? [b] : [a, b]); expect(calls).toBe(1);
});

for (const next of ['查找', '原片段'] as const) test(`等待删除响应取消后保留${next}意图，已提交删除仍只执行一次`, async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url); await openDelete(page, a!);
  const gate = await holdResponse(page, '/api/segments/modify');
  try {
    await dialog(page).getByRole('button', { name: '删除', exact: true }).click(); await gate.received;
    await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
    if (next === '查找') { await page.getByRole('button', { name: '查找', exact: true }).click(); await page.getByLabel('查找文案', { exact: true }).fill('B'); }
    else await expect(page.locator(`[row-id="${a}"] :focus`)).toHaveCount(1);
  } finally { gate.release(); }
  await gate.delivered; await expect(page.locator(`[row-id="${a}"]`)).toHaveCount(0);
  if (next === '查找') { await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused(); await expect(page.getByLabel('查找文案', { exact: true })).toHaveValue('B'); }
  else { await expect(page.locator(`[row-id="${b}"] :focus`)).toHaveCount(1); await page.keyboard.press('ArrowDown'); await expect(page.locator(`[row-id="${c}"] [col-id="text"]`)).toBeFocused(); }
  expect(gate.calls).toBe(1); expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([b, c]);
});

test('删除确认从详情入口交接不提前回表格，取消后继续方向键', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  await page.locator(`[row-id="${b}"] [data-row-details]`).click({ button: 'right' });
  await page.evaluate(() => { document.body.dataset.intermediateTableFocus = 'false'; document.addEventListener('focusin', event => { if ((event.target as Element).closest('[row-id]')) document.body.dataset.intermediateTableFocus = 'true'; }); });
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-intermediate-table-focus', 'false');
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator(`[row-id="${b}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.locator(`[row-id="${c}"] [role="gridcell"]:focus`)).toHaveCount(1);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' }); await page.keyboard.press('Escape');
  await expect(page.locator(`[row-id="${a}"] [col-id="text"]`)).toBeFocused();
});

test('确认来源真实虚拟卸载后取消恢复稳定身份，空表采用更多后备', async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 60 }, (_, i) => `片段 ${i}`)); await page.goto(project.url);
  await openDelete(page, ids[1]!);
  await project.modify({ changes: [{ kind: 'reorder', expectedIds: ids, ids: [...ids.filter(id => id !== ids[1]), ids[1]!] }] });
  await expect(page.locator(`[row-id="${ids[1]}"]`)).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(page.locator(`[row-id="${ids[1]}"] [col-id="text"]`)).toBeFocused();
  await openDelete(page, ids[1]!);
  await project.modify({ changes: (await project.status()).snapshot.segments.map(expected => ({ kind: 'delete' as const, expected })) });
  await expect(page.locator('.ag-row[row-id]')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
});

for (const outcome of ['成功', '失败'] as const) test(`迟到删除${outcome}不抢新查找、勾选和手动滚动`, async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 50 }, (_, i) => `保留 ${i}`)); await page.goto(project.url); await openDelete(page, ids[0]!);
  let release!: () => void, received!: () => void; let calls = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; }); const arrived = new Promise<void>(resolve => { received = resolve; });
  await page.route('**/api/segments/modify', async route => { calls++; const response = outcome === '成功' ? await route.fetch() : undefined; received(); await waiting; if (response) await route.fulfill({ response }); else await route.fulfill({ status: 500, json: { error: '本例迟到删除失败' } }); });
  let scroll = 0;
  try {
    await dialog(page).getByRole('button', { name: '删除', exact: true }).click(); await arrived;
    await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
    await page.locator(`[row-id="${ids[0]}"] input[type="checkbox"]`).click();
    await page.locator(`[row-id="${ids[1]}"] input[type="checkbox"]`).click();
    await page.getByRole('button', { name: '查找', exact: true }).click(); await page.getByLabel('查找文案', { exact: true }).fill('保留');
    const viewport = page.locator('.ag-grid-viewport'); await page.mouse.move(150, 350); await page.mouse.wheel(0, 600);
    await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    scroll = await viewport.evaluate(node => node.scrollTop);
  } finally { release(); }
  await expect(page.locator('[data-save-status]')).toHaveText(outcome === '成功' ? '已保存' : '保存失败');
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused(); await expect(page.getByLabel('查找文案', { exact: true })).toHaveValue('保留');
  expect(await page.locator('.ag-grid-viewport').evaluate(node => node.scrollTop)).toBe(scroll);
  // 勾选所在行可能已经虚拟卸载；通过重新回到行位置读取其稳定身份。
  await page.locator('.ag-grid-viewport').evaluate(node => { node.scrollTop = 0; });
  await expect(page.locator(`[row-id="${ids[1]}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(1);
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual(outcome === '成功' ? ids.slice(1) : ids); expect(calls).toBe(1);
});

test('删除确认关闭后新空白点击取消尚未执行的来源恢复', async ({ page, project }) => {
  await page.setViewportSize({ width: 420, height: 420 });
  const ids = await project.seed(Array.from({ length: 70 }, (_, i) => `片段 ${i}`)); await page.goto(project.url); await openDelete(page, ids[0]!);
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
  await page.mouse.click(5, 5);
  const scroll = await page.locator('.ag-grid-viewport').evaluate(node => node.scrollTop);
  await page.clock.runFor(100);
  await expect(page.locator('[row-id] :focus')).toHaveCount(0);
  expect(await page.locator('.ag-grid-viewport').evaluate(node => node.scrollTop)).toBe(scroll);
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual(ids);
});
