import type { Page } from '@playwright/test';
import { test, expect } from './helpers/project.js';

// Chromium 无头模式默认隐藏滚动条，会掩盖滚动条改变可用列宽的问题。
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], executablePath: process.env.CHROME_BIN } });
const sideColumns = '[role="columnheader"]:is([col-id="materials"], [col-id="speech"]), [data-segment-support], [data-segment-speech] > button';

test('首行进入和退出编辑使表格跨过纵向滚动阈值时，素材和配音列保持位置', async ({ page, project }) => {
  const ids = await project.seed([
    '今天，我们来做一杯手冲咖啡。',
    '先用热水润湿滤纸，顺便把分享壶温一下。',
    '倒入咖啡粉，轻轻晃平。',
    '从中心注入少量热水，让咖啡粉均匀湿透。等大约三十秒，看到表面的气泡慢慢变少，再开始下一次注水。',
    '接下来把水流放细，从中心往外画小圈，快到滤纸边缘时就往回收。',
    '等最后几滴咖啡落下，移开滤杯。先闻一闻，再趁温热尝一口。',
  ]);
  await page.setViewportSize({ width: 780, height: 578 });
  await page.goto(project.url);
  const first = page.locator(`[row-id="${ids[0]}"]`);
  const last = page.locator(`[row-id="${ids.at(-1)}"]`);
  const viewport = page.locator('.ag-grid-viewport');
  await expect(last).toBeInViewport({ ratio: 0.999 });
  const free = (await viewport.boundingBox())!.y + (await viewport.boundingBox())!.height - ((await last.boundingBox())!.y + (await last.boundingBox())!.height);
  await page.setViewportSize({ width: 780, height: Math.round(578 - free + 12) });
  const overflow = () => viewport.evaluate(element => element.scrollHeight > element.clientHeight);
  await expect.poll(overflow).toBe(false);
  const editor = first.getByRole('textbox', { name: '文案全文', exact: true });
  await recordTransition(page, async () => {
    await first.locator('[data-segment-script]').click();
    await expect(editor).toBeFocused();
    await expect.poll(overflow).toBe(true);
    await expect(page.locator('.ag-body-vertical-scroll')).toBeVisible();
  }, sideColumns, 16);
  await recordTransition(page, async () => {
    await editor.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect.poll(overflow).toBe(false);
  }, sideColumns);
});

/** 同时检查交接中的每一帧和结束后的布局，避免只验证最终静态页面。 */
async function recordTransition(page: Page, action: () => Promise<void>, selector = `header, footer, .segment-grid, .ag-grid-viewport, [col-id="order"] button, header button, footer button, ${sideColumns}`, settleFrames = 3) {
  const recording = page.evaluate(async ({ selector, settleFrames }) => {
    const captureState = { done: false };
    (window as typeof window & { editingCapture?: typeof captureState }).editingCapture = captureState;
    const capture = () => {
      const nodes = [...document.querySelectorAll<HTMLElement>(selector)];
      return nodes.filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && node.getAttribute('aria-label') !== '回到草稿').map(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        const row = node.closest('[row-id]');
        const key = `${row?.getAttribute('row-id') ?? ''}:${node.tagName}:${node.getAttribute('aria-label') ?? node.getAttribute('data-segment-support') ?? node.className}:${node.tagName === 'BUTTON' ? node.textContent?.trim() : ''}`;
        // 草稿撑高所在行，后续行整体下移。行内控件相对于所在行应保持稳定。
        const y = rect.y - (row?.getBoundingClientRect().y ?? 0);
        return { key, x: rect.x, y, width: rect.width, height: rect.height, opacity: style.opacity };
      });
    };
    const frames = [capture()];
    await new Promise<void>(resolve => {
      let settled = 0;
      const frame = () => { frames.push(capture()); if (captureState.done) settled++; if (settled < settleFrames) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    return frames;
  }, { selector, settleFrames });
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

test('窄面板展开编辑时操作栏保持单行，下方片段只移动一次', async ({ page, project }, testInfo) => {
  const [target, following] = await project.seed(['先用热水润湿滤纸，顺便把分享壶温一下。', '倒入咖啡粉，轻轻晃平。']);
  await page.setViewportSize({ width: 780, height: 578 });
  await page.goto(project.url);
  const row = page.locator(`[row-id="${target}"]`);
  await expect(row.locator('[data-segment-script]')).toBeVisible();
  const frames = page.evaluate(async ({ target, following }) => {
    const row = document.querySelector(`[row-id="${target}"]`)!;
    const next = document.querySelector(`[row-id="${following}"]`)!;
    const offsets = [next.getBoundingClientRect().top - row.getBoundingClientRect().top];
    const gaps: number[] = [];
    let editFrames = 0;
    const startedAt = performance.now();
    while (editFrames < 8 && performance.now() - startedAt < 3000) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const top = next.getBoundingClientRect().top - row.getBoundingClientRect().top;
      if (top !== offsets.at(-1)) offsets.push(top);
      const footer = row.querySelector('[role="group"]');
      if (footer) {
        editFrames++;
        gaps.push(Math.round(next.getBoundingClientRect().top - footer.getBoundingClientRect().bottom));
      }
    }
    return { offsets, editFrames, gaps };
  }, { target, following });
  await row.locator('[data-segment-script]').click();
  const actions = row.getByRole('group', { name: '文案编辑操作' });
  await expect(actions).toBeVisible();
  const sample = await frames;
  const height = (await actions.boundingBox())!.height;
  await testInfo.attach('编辑展开几何', { body: JSON.stringify({ ...sample, height }), contentType: 'application/json' });
  expect(sample.editFrames).toBe(8);
  expect(sample.offsets.length).toBeLessThanOrEqual(2);
  expect(height).toBe(32);
  // requestAnimationFrame 的首次采样可能早于本帧的 ResizeObserver 通知。
  expect(sample.gaps.slice(1).every(gap => gap >= 0)).toBe(true);
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
