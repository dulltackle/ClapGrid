import type { Page } from '@playwright/test';
import { test, expect } from './helpers/project.js';

/** 同时检查交接中的每一帧和结束后的布局，避免只验证最终静态页面。 */
async function recordTransition(page: Page, action: () => Promise<void>) {
  const recording = page.evaluate(async () => {
    const captureState = { done: false };
    (window as typeof window & { editingCapture?: typeof captureState }).editingCapture = captureState;
    const capture = () => {
      const nodes = [...document.querySelectorAll<HTMLElement>('header, footer, .segment-grid, .ag-grid-viewport, [data-segment-support], [col-id="order"] button, [data-segment-speech] > button, header button, footer button')];
      return nodes.filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && node.getAttribute('aria-label') !== '回到草稿').map(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        const row = node.closest('[row-id]')?.getAttribute('row-id') ?? '';
        const key = `${row}:${node.tagName}:${node.getAttribute('aria-label') ?? node.getAttribute('data-segment-support') ?? node.className}:${node.tagName === 'BUTTON' ? node.textContent?.trim() : ''}`;
        return { key, x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: style.opacity };
      });
    };
    const frames = [capture()];
    await new Promise<void>(resolve => {
      let settled = 0;
      const frame = () => { frames.push(capture()); if (captureState.done) settled++; if (settled < 3) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    return frames;
  });
  try { await action(); }
  finally { await page.evaluate(() => { const state = (window as typeof window & { editingCapture?: { done: boolean } }).editingCapture; if (state) state.done = true; }); }
  const frames = await recording;
  // 样式类可以随业务状态变化，按相同区域及稳定身份比较几何和实际透明度。
  const shape = (frame: typeof frames[number]) => frame.map(({ key, ...appearance }) => appearance);
  const baseline = shape(frames[0]!);
  const differences = frames.flatMap(frame => shape(frame).flatMap((appearance, index) => JSON.stringify(appearance) === JSON.stringify(baseline[index]) ? [] : [{ element: frame[index]!.key, before: baseline[index], after: appearance }]));
  const unique = [...new Map(differences.map(item => [item.element, item])).values()];
  expect(unique).toEqual([]);
}

test('编辑切换保留素材区与配音区的现有 DOM', async ({ page, project }) => {
  const [id] = await project.seed(['保持素材缩略图与配音控件']);
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  const support = await row.locator('[data-segment-support]').elementHandle();
  const speech = await row.locator('[data-segment-speech]').elementHandle();
  await row.locator('[data-segment-script]').click();
  await expect(page.getByLabel('文案全文', { exact: true })).toBeEditable();
  expect(await support!.evaluate(node => node.isConnected)).toBe(true);
  expect(await speech!.evaluate(node => node.isConnected)).toBe(true);
});

test('退出部分可见片段的编辑时不把整行滚入视口', async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 12 }, (_, index) => `片段 ${index + 1}`));
  await page.setViewportSize({ width: 780, height: 579 });
  await page.goto(project.url);
  const viewport = page.locator('.ag-grid-viewport');
  await viewport.evaluate(element => { element.scrollTop = 150; });
  await page.locator(`[row-id="${ids[5]}"] [data-segment-script]`).click();
  const editor = page.getByLabel('文案全文', { exact: true });
  await expect(editor).toBeEditable();
  const before = await viewport.evaluate(element => element.scrollTop);
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.locator(`[row-id="${ids[5]}"] [col-id="text"]`)).toBeFocused();
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(before);
});

for (const width of [780, 420]) for (const action of ['进入', '切换', '退出', '保存', '放弃'] as const) {
  test(`${width} ${action}编辑时持久控件和表格布局稳定`, async ({ page, project }) => {
    const ids = await project.seed(Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 条测试文案，检查编辑交接。`));
    await page.setViewportSize({ width, height: 579 });
    await page.goto(project.url);
    const add = page.getByRole('button', { name: '新增口播片段', exact: true });
    await expect(add).toBeEnabled(); await expect(add).toHaveCSS('opacity', '1');
    await page.locator(`[row-id="${ids[0]}"] input[type="checkbox"]`).check();
    await expect(page.getByRole('button', { name: '清空勾选', exact: true })).toHaveCSS('opacity', '1');
    const script = (index: number) => page.locator(`[row-id="${ids[index]}"] [data-segment-script]`);
    const editor = page.getByLabel('文案全文', { exact: true });
    if (action !== '进入') { await script(0).click(); await expect(editor).toBeEditable(); }
    if (action === '保存' || action === '放弃') await editor.fill('第 1 条修改文案，检查编辑交接。');
    if (action === '放弃') {
      await editor.press('Escape');
      await page.getByRole('button', { name: '放弃修改', exact: true }).waitFor();
    }
    await recordTransition(page, async () => {
      if (action === '进入') await script(0).click();
      if (action === '切换') await script(1).click();
      if (action === '退出') await editor.press('Escape');
      if (action === '保存') await editor.press('Control+Enter');
      if (action === '放弃') await page.getByRole('button', { name: '放弃修改', exact: true }).click();
      if (action === '保存') await expect(editor).toHaveValue('第 2 条测试文案，检查编辑交接。');
      else if (action === '进入' || action === '切换') await expect(editor).toBeEditable();
      else await expect(editor).toHaveCount(0);
    });
  });
}
