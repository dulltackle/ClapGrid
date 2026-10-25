import { test, expect } from './helpers/project.js';
import { holdResponse } from './helpers/response-gate.js';

for (const [width, height] of [[1600, 1000], [420, 720], [420, 360]]) test(`查找高亮、循环与勾选独立 ${width}×${height}`, async ({ page, project }) => {
  const [a, b, c] = await project.seed(['Hello world / HELLO WORLD', 'hello other world', 'hello world']);
  await page.setViewportSize({ width: width!, height: height! }); await page.goto(project.url);
  const grid = page.locator('.segment-grid'); await expect(page.locator(`[row-id="${a}"]`)).toBeVisible();
  const bounds = await grid.boundingBox();
  const find = page.getByRole('button', { name: '查找', exact: true });
  await find.click(); const query = page.getByLabel('查找文案', { exact: true });
  await expect(query).toBeFocused(); expect(await grid.boundingBox()).toEqual(bounds);
  await expect(page.getByRole('button', { name: '下一个', exact: true })).toBeDisabled();
  await query.fill('hello world');
  await expect(page.locator('mark')).toHaveCount(3);
  await expect(page.locator(`[row-id="${b}"]`)).toBeVisible();
  const count = page.getByLabel('查找口播片段').getByRole('status');
  await expect(count).toHaveAttribute('aria-label', /第 1 \/ 2/);
  await page.locator(`[row-id="${b}"] input[type="checkbox"]`).check();
  await query.press('Enter'); await expect(count).toHaveAttribute('aria-label', /第 2 \/ 2/);
  await query.press('Enter'); await expect(count).toHaveAttribute('aria-label', /第 1 \/ 2/);
  await query.press('Shift+Enter'); await expect(count).toHaveAttribute('aria-label', /第 2 \/ 2/);
  await expect(page.locator(`[row-id="${b}"]`)).toHaveClass(/ag-row-selected/);
  await query.fill('2'); await expect(count).toHaveAttribute('aria-label', /无匹配片段/);
  await query.fill('hello world'); await query.press('Escape');
  await expect(query).toHaveCount(0); await expect(find).toBeFocused(); await expect(page.locator('mark')).toHaveCount(0);
  await find.click(); await expect(query).toHaveValue('hello world');
  await page.reload(); await find.click(); await expect(query).toHaveValue('');
  expect((await project.status()).snapshot.segments.map(s => s.id)).toEqual([a,b,c]);
});

test('虚拟屏外长文案命中完整可见，轮询不抢编辑且失效等待显式定位', async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 80 }, (_, i) => i === 79 ? '长文案\n'.repeat(80) + 'far needle' : '普通文案'));
  await page.setViewportSize({ width: 420, height: 360 }); await page.goto(project.url);
  await expect(page.locator(`[row-id="${ids[0]}"]`)).toBeVisible();
  await expect(page.locator(`[row-id="${ids[79]}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: '查找', exact: true }).click();
  const query = page.getByLabel('查找文案', { exact: true }); await query.fill('far needle');
  const current = page.locator('.text-search-current'); await expect(current.locator('mark')).toHaveText('far needle');
  await expect.poll(async () => current.evaluate(e => {
    const mark=e.querySelector('mark')!.getBoundingClientRect(), bounds=e.closest('[role="gridcell"]')!.getBoundingClientRect();
    return mark.top >= bounds.top && mark.bottom <= bounds.bottom && !!document.elementFromPoint(mark.left+2,mark.top+2)?.closest('mark');
  })).toBe(true);
  await query.press('Escape');
  const target = page.locator(`[row-id="${ids[79]}"] [data-segment-script]`);
  // 持有修改权时产品有意不启动新轮询；暂停此前已发出的真实浏览器轮询以覆盖迟到响应。
  const poll = await holdResponse(page, '/api/status');
  await poll.received;
  const editor = page.getByLabel('文案全文', { exact: true });
  try { await target.click(); await editor.fill('新的输入'); } finally { poll.release(); }
  await poll.delivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect.poll(async () => (await project.status()).modification?.owner).toBe('user');
  await expect(editor).toBeFocused(); await expect(editor).toHaveValue('新的输入'); await editor.press('Control+Enter');
  await expect.poll(async () => (await project.status()).snapshot.segments[79]!.text).toBe('新的输入');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.getByLabel('查找口播片段').getByRole('status')).toHaveAttribute('aria-label', /无匹配片段/);
  const snapshot=(await project.status()).snapshot;
  await project.modify({ changes: [{kind:'edit',expected:snapshot.segments[79]!,text:'far needle 恢复'}] });
  await expect(page.getByLabel('查找口播片段').getByRole('status')).toHaveAttribute('aria-label', /点击下一个定位/);
  await expect(current).toHaveCount(0);
  await page.getByRole('button',{name:'下一个',exact:true}).click(); await expect(current).toContainText('far needle');
});

test('两个原生标签页的查找词互相独立', async ({ page, context, project }) => {
  await project.seed(['甲乙']); await page.goto(project.url);
  await page.getByRole('button', {name:'查找',exact:true}).click(); await page.getByLabel('查找文案',{exact:true}).fill('甲');
  const second=await context.newPage(); await second.goto(project.url);
  await second.getByRole('button',{name:'查找',exact:true}).click();
  await expect(second.getByLabel('查找文案',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('查找文案',{exact:true})).toHaveValue('甲');
});
