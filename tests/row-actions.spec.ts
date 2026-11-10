import { test, expect } from './helpers/project.js';

for (const environment of ['wide', 'compact', 'touch'] as const) test.describe(environment, () => {
  test.use({ viewport: environment === 'wide' ? { width: 1200, height: 800 } : { width: 780, height: 579 }, hasTouch: environment === 'touch', isMobile: environment === 'touch' });
  test('文案保存后，本行菜单和页脚删除不依赖悬停与右键', async ({ page, project }) => {
    const [a, b] = await project.seed(['第一句', '第二句']); await page.goto(project.url);
    const first = page.locator(`[row-id="${a}"]`);
    await expect(first.getByRole('button', { name: '片段 1 本行菜单', exact: true })).toBeVisible();
    await expect(first.getByRole('button', { name: '拖动片段 1', exact: true })).toHaveCSS('opacity', '1');
    await expect(page.getByLabel('口播片段详情', { exact: true })).toHaveCount(0);
    await first.locator('[col-id="text"]').press('F2');
    const input = page.getByLabel('文案全文', { exact: true });
    await input.fill('新的第一句');
    await input.press('Control+Enter');
    await expect(input).toHaveCount(0);
    expect((await project.status()).snapshot.segments[0]!.text).toBe('新的第一句');
    await first.getByRole('button', { name: /片段 1 画面素材/ }).press('Enter');
    await page.getByRole('dialog', { name: '片段 1 素材面板', exact: true }).getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).press('Enter');
    await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await first.getByRole('button', { name: '片段 1 本行菜单', exact: true }).press('Enter');
    await page.getByRole('menuitem', { name: '下方添加', exact: true }).press('Enter');
    await expect(page.getByLabel('文案全文', { exact: true })).toHaveValue('');
    await page.getByLabel('文案全文', { exact: true }).press('Escape');
    await first.locator('input[type="checkbox"]').check();
    await page.locator(`[row-id="${b}"] input[type="checkbox"]`).check();
    await page.getByRole('button', { name: '删除已勾选', exact: true }).press('Enter');
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).press('Enter');
    expect((await project.status()).snapshot.segments).toHaveLength(3);
    await page.getByRole('button', { name: '删除已勾选', exact: true }).press('Enter');
    await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).press('Enter');
    await expect.poll(async () => (await project.status()).snapshot.segments.map(item => item.text)).toEqual(['']);
  });
});

test('拖动手柄以 Enter 拾取、方向键定位，Esc 取消或 Enter 提交', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  const handle = page.getByRole('button', { name: '拖动片段 1', exact: true });
  await handle.press('Enter'); await handle.press('ArrowDown'); await handle.press('Escape');
  expect((await project.status()).snapshot.segments.map(item => item.id)).toEqual([a, b]);
  await handle.press('Enter'); await handle.press('ArrowDown'); await handle.press('Enter');
  await expect.poll(async () => (await project.status()).snapshot.segments.map(item => item.id)).toEqual([b, a]);
});

for (const viewport of [{ width: 1200, height: 800 }, { width: 780, height: 579 }]) test(`原生 Tab 经过各行文案、画面、配音和本行菜单 ${viewport.width}`, async ({ page, project }) => {
  await page.setViewportSize(viewport); await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator('[row-index="0"] [col-id="text"]').focus();
  const visited: string[] = [];
  for (let step = 0; step < 30; step++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => document.activeElement instanceof HTMLButtonElement ? document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent ?? '' : '');
    visited.push(label);
    if (label === '片段 2 本行菜单') break;
  }
  expect(visited.filter(label => /画面素材|生成配音|配音更多操作|本行菜单/.test(label))).toEqual([
    '片段 1 画面素材（0）', '生成配音', '片段 1 配音更多操作', '片段 1 本行菜单',
    '片段 2 画面素材（0）', '生成配音', '片段 2 配音更多操作', '片段 2 本行菜单',
  ]);
});

test.describe('真实触控输入', () => {
  test.use({ viewport: { width: 780, height: 579 }, hasTouch: true, isMobile: true });
  test('无需悬停或右键即可关联、打开本行菜单、取消删除并拖动片段', async ({ page, project, context }) => {
    const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    await page.locator(`[row-id="${a}"]`).getByRole('button', { name: /片段 1 画面素材/ }).tap();
    await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).tap();
    await page.getByRole('button', { name: /片段 1 画面素材/ }).tap();
    await page.getByRole('button', { name: '片段 1 本行菜单', exact: true }).tap();
    await page.getByRole('menuitem', { name: '删除本片段', exact: true }).tap();
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).tap();
    const handle = page.getByRole('button', { name: '拖动片段 1', exact: true });
    await expect(handle).toBeEnabled();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // 表格刷新会替换序号入口；在同一个浏览器任务中读取当前节点，避免跨协议调用持有旧节点。
    const pointsHandle = await page.waitForFunction(({ a, b }) => {
      const origin = document.querySelector(`[row-id="${a}"] button[aria-label="拖动片段 1"]`)?.getBoundingClientRect();
      const destination = document.querySelector(`[row-id="${b}"] [col-id="order"]`)?.getBoundingClientRect();
      if (!origin?.width || !origin.height || !destination?.width || !destination.height) return null;
      return { origin: { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 },
        destination: { x: destination.x + 15, y: destination.y + destination.height - 5 } };
    }, { a, b });
    const points = await pointsHandle.jsonValue();
    await pointsHandle.dispose();
    if (!points) throw new Error('触控拖动入口和目标必须可见');
    const touch = await context.newCDPSession(page);
    // Playwright 没有连续触控拖动 API；CDP 只负责设备输入，项目与表格保持真实。
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.origin] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [points.destination] });
    await expect(page.getByText('移动 1 条', { exact: true })).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await project.status()).snapshot.segments.map(item => item.id)).toEqual([b, a]);
    await touch.detach();
  });
});
