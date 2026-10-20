import { test, expect } from './helpers/project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';
import { beginEdit } from '../src/shared/client.js';
import type { Page } from '@playwright/test';

async function begin(page: Page, id: string) {
  const handle = page.locator(`[row-id="${id}"] [aria-label^="拖动片段 "]`);
  await handle.hover();
  let box: Awaited<ReturnType<typeof handle.boundingBox>>;
  await expect.poll(async () => { box = await handle.boundingBox(); return box !== null; }).toBe(true);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
}
async function target(page: Page, id: string, after = true) {
  const box = (await page.locator(`[row-id="${id}"] [col-id="order"]`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * (after ? .8 : .2), { steps: 8 });
  const line = page.getByLabel('口播片段插入位置', { exact: true });
  await expect(line).toHaveAttribute('data-target-id', id); await expect(line).toHaveAttribute('data-placement', after ? 'after' : 'before');
}

for (const width of [1600, 420]) test(`真实指针拖动多选范围且保留原顺序 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 1000 });
  const ids = await project.seed(Array.from({ length: 6 }, (_, i) => `片段 ${i + 1}`)); await page.goto(project.url);
  await page.locator('[col-id="order"] .ag-header-cell-label').click(); await page.locator('[col-id="order"] .ag-header-cell-label').click();
  await expect(page.locator(`[row-id="${ids[0]}"]`)).toHaveAttribute('row-index', '0');
  await page.locator(`[row-id="${ids[1]}"] input[type="checkbox"]`).click(); await page.locator(`[row-id="${ids[3]}"] input[type="checkbox"]`).click();
  await begin(page, ids[3]!); await target(page, ids[4]!); await page.mouse.up();
  await expect.poll(async () => (await project.status()).snapshot.segments.map(s => s.id)).toEqual([ids[0], ids[2], ids[4], ids[1], ids[3], ids[5]]);
  await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(2);
});

test('拖未选中行仅移动自身，Escape及自身目标或不变顺序不提交', async ({ page, project }) => {
  const ids = await project.seed(['1', '2', '3', '4', '5', '6']); await page.goto(project.url);
  await page.locator(`[row-id="${ids[1]}"] input[type="checkbox"]`).click(); await page.locator(`[row-id="${ids[3]}"] input[type="checkbox"]`).click();
  let calls = 0; page.on('request', request => { if (request.url().endsWith('/api/segments/modify')) calls++; });
  await begin(page, ids[5]!); await target(page, ids[0]!, false); await page.mouse.up();
  await expect.poll(async () => (await project.status()).snapshot.segments.map(s => s.id)).toEqual([ids[5], ...ids.slice(0, 5)]);
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(1); await expect(page.locator(`[row-id="${ids[5]}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-save-status]')).toHaveText('已保存'); const saved = calls;
  await begin(page, ids[5]!); await target(page, ids[0]!, false); await page.mouse.up();
  await expect(page.getByLabel('口播片段插入位置', { exact: true })).toHaveCount(0); expect(calls).toBe(saved);
  await begin(page, ids[5]!); await target(page, ids[4]!); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByLabel('口播片段插入位置', { exact: true })).toHaveCount(0); expect(calls).toBe(saved);
  await begin(page, ids[5]!); await target(page, ids[5]!); await page.mouse.up(); expect(calls).toBe(saved);
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([ids[5], ...ids.slice(0, 5)]);
});

test('松手立即预览，真实取得修改权与保存等待不覆盖预览，失败回滚', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  const acquire = await holdRequest(page, '/api/edit-session'); const save = await holdResponse(page, '/api/segments/modify');
  try {
    await begin(page, a!); await target(page, b!); await page.mouse.up(); await acquire.received;
    await expect(page.locator(`[row-id="${a}"]`)).toHaveAttribute('row-index', '1'); await expect(page.locator('[data-save-status]')).toContainText('保存中');
    expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([a, b]);
    acquire.release(); await save.received;
    await expect(page.locator(`[row-id="${a}"]`)).toHaveAttribute('row-index', '1');
  } finally { acquire.release(); save.release(); }
  await save.delivered; await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([b, a]);
  await page.unroute('**/api/segments/modify');
  await page.route('**/api/segments/modify', route => route.fulfill({ status: 500, json: { error: '本例重排保存失败' } }));
  await begin(page, a!); await target(page, b!, false); await page.mouse.up();
  await expect(page.locator('[data-save-status]')).toHaveText('保存失败'); await expect(page.locator('footer')).toContainText('本例重排保存失败');
  await expect(page.locator(`[row-id="${a}"]`)).toHaveAttribute('row-index', '1');
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([b, a]);
});

for (const change of ['外部修改权', '顺序变化'] as const) test(`拖动期间${change}拒绝提交，不覆盖服务数据`, async ({ page, project }) => {
  const ids = await project.seed(['A', 'B', 'C', 'D']); await page.goto(project.url);
  await begin(page, ids[0]!); await target(page, ids[2]!);
  let calls = 0; page.on('request', request => { if (request.url().endsWith('/api/segments/modify')) calls++; });
  const edit = change === '外部修改权' ? await beginEdit(project.url) : undefined;
  try {
    if (edit) await expect(page.locator(`[row-id="${ids[0]}"] [aria-label^="拖动片段 "]`)).toBeDisabled();
    else { await project.modify({ changes: [{ kind: 'reorder', expectedIds: ids, ids: [...ids].reverse() }] }); await expect(page.locator(`[row-id="${ids[0]}"]`)).toHaveAttribute('row-index', '3'); }
    await page.mouse.up(); await expect(page.locator('footer')).toContainText(change === '外部修改权' ? '拖拽未提交' : '顺序已变化'); expect(calls).toBe(0);
    expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual(edit ? ids : [...ids].reverse());
  } finally { await edit?.close(); await page.mouse.up(); }
});

for (const width of [1600, 420]) test(`虚拟滚轮后静止指针采用当前真实目标 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 800 });
  const ids = await project.seed(Array.from({ length: 100 }, (_, i) => `片段 ${i + 1}`)); await page.goto(project.url);
  await begin(page, ids[0]!); await target(page, ids[4]!);
  const box = (await page.locator(`[row-id="${ids[4]}"] [col-id="order"]`).boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height * .8;
  await page.mouse.wheel(0, box.height * 40);
  const current = () => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[row-id]')?.getAttribute('row-id'), { x, y });
  await expect.poll(current).not.toBe(ids[4]);
  const id = (await current())!; expect(ids.indexOf(id)).toBeGreaterThan(30);
  const line = page.getByLabel('口播片段插入位置', { exact: true }); await expect(line).toHaveAttribute('data-target-id', id); await expect(line).toHaveAttribute('data-placement', 'after');
  await page.mouse.up();
  await expect.poll(async () => { const order = (await project.status()).snapshot.segments.map(s => s.id); return order.indexOf(ids[0]!) - order.indexOf(id); }).toBe(1);
});

for (const edge of ['下', '上'] as const) test(`拖拽${edge}边缘自动滚动经过真实指针及虚拟行`, async ({ page, project }) => {
  await page.setViewportSize({ width: 420, height: 420 });
  const ids = await project.seed(Array.from({ length: 100 }, (_, i) => `片段 ${i + 1}`)); await page.goto(project.url);
  const viewport = page.locator('.ag-grid-viewport');
  if (edge === '上') { await viewport.hover(); await page.mouse.wheel(0, 4000); await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(3000); }
  const visible = await viewport.evaluate(element => {
    const v = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('.ag-row[row-id]')].find(row => { const r = row.getBoundingClientRect(); return r.top >= v.top && r.bottom < v.bottom; })!.getAttribute('row-id')!;
  });
  await begin(page, visible);
  const bounds = (await viewport.boundingBox())!; const start = await viewport.evaluate(node => node.scrollTop);
  await page.mouse.move(bounds.x + 55, edge === '下' ? bounds.y + bounds.height - 8 : bounds.y + 8, { steps: 10 });
  // 边缘可能落在行间空隙；先由真实滚动证明持续边缘动作，再在中部读取有效行。
  if (edge === '下') await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(start + 200);
  else await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeLessThan(start - 200);
  // 离开边缘到视口中部让自动滚动停止，再读取真正目标并松手。
  const x = bounds.x + 55, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  const id = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)!.closest('[row-id]')!.getAttribute('row-id')!, { x, y });
  const line = page.getByLabel('口播片段插入位置', { exact: true }); await expect(line).toHaveAttribute('data-target-id', id);
  const after = await line.getAttribute('data-placement') === 'after'; await page.mouse.up();
  await expect.poll(async () => { const order = (await project.status()).snapshot.segments.map(s => s.id); return order.indexOf(visible) - order.indexOf(id); }).toBe(after ? 1 : -1);
  expect((await project.status()).snapshot.segments).toHaveLength(ids.length);
});
