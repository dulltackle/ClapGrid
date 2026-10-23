import { test, expect } from './helpers/media-project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';
import { importVideo } from '../src/shared/client.js';

for (const viewport of [{ width: 1600, height: 1000 }, { width: 420, height: 360 }]) test(`真实视频导入关联、缩略图解码和原生预览 ${viewport.width}`, async ({ page, project, mediaFiles }) => {
  await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' });
  const [id] = await project.seed(['视频片段']); await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '导入本地视频', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入并复制', exact: true })).toBeDisabled();
  await page.getByLabel('视频文件绝对路径', { exact: true }).fill(mediaFiles.video);
  await page.getByRole('button', { name: '导入并复制', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导入本地视频', exact: true })).toHaveCount(0);
  const asset = (await project.status()).snapshot.assets[0]!; expect(asset.duration).toBeCloseTo(4, 1);
  await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  await page.getByRole('button', { name: '关联', exact: true }).click();
  await page.getByLabel('关联素材', { exact: true }).selectOption(asset.id);
  await page.getByLabel('播放起点（秒）', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存关联与起点', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
  expect((await project.status()).snapshot.segments[0]!.video).toEqual({ assetId: asset.id, start: 1 });
  const parent = page.getByRole('complementary', { name: '口播片段详情', exact: true });
  await expect.poll(() => parent.getByRole('button', { name: '播放预览', exact: true }).locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '播放 实际素材.mp4', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '视频预览', exact: true }); const video = dialog.locator('video');
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState >= 2 && !(node as HTMLVideoElement).paused && (node as HTMLVideoElement).currentTime >= 1)).toBe(true);
  expect(await video.evaluate(node => (node as HTMLVideoElement).duration)).toBeCloseTo(4, 1); await expect(video).toHaveAttribute('controls', '');
  await video.focus(); await page.keyboard.press('Space'); await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await page.keyboard.press('Space'); await expect.poll(() => video.evaluate(node => !(node as HTMLVideoElement).paused)).toBe(true);
  await page.keyboard.press('Tab'); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  const close = dialog.getByRole('button', { name: '关闭预览', exact: true });
  await close.focus(); await expect(close).toBeFocused();
  // 从关闭入口反向遍历原生视频 controls，再按正向返回；双向焦点始终留在模态。
  for (const key of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await close.focus();
  await page.keyboard.press('Escape'); await expect(video).toHaveCount(0);
  await expect(page.locator(`[row-id="${id}"] :focus`)).toHaveCount(1);
});

for (const unavailable of ['hidden', 'disabled', 'detached'] as const) test(`嵌套预览父入口${unavailable}时回父层，关闭后仍回原片段`, async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A', 'B']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await project.modify({ changes: [{ kind: 'video', expected: (await project.status()).snapshot.segments[0]!, assetId: asset.id, start: 0 }] });
  await page.goto(project.url); await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  const trigger = page.getByRole('button', { name: '播放预览', exact: true }); await trigger.press('Enter');
  await expect(page.getByRole('dialog', { name: '视频预览', exact: true })).toBeVisible();
  // 只建立父候选不可用的模块条件；打开/关闭和返回仍通过原生键盘。
  await page.locator('aside [aria-label="播放预览"]').evaluate((node, unavailable) => {
    if (unavailable === 'hidden') (node as HTMLElement).hidden = true;
    else if (unavailable === 'disabled') (node as HTMLButtonElement).disabled = true;
    else node.remove();
  }, unavailable);
  await page.keyboard.press('Escape'); await expect(page.getByRole('complementary', { name: '口播片段详情', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator(`[row-id="${id}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.locator('[row-index="1"] [role="gridcell"]:focus')).toHaveCount(1);
  expect((await project.status()).modification).toBeNull();
});

test('关联保存失败关闭子层保留父来源，可重新关联并解除', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await page.goto(project.url); await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  await page.getByRole('button', { name: '关联', exact: true }).click();
  await page.getByLabel('关联素材', { exact: true }).selectOption(asset.id);
  await page.route('**/api/segments/modify', route => route.fulfill({ status: 500, json: { error: '本例关联失败' } }));
  await page.getByRole('button', { name: '保存关联与起点', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary').getByRole('alert')).toContainText('本例关联失败');
  expect((await project.status()).snapshot.segments[0]!.video).toBeNull();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await page.unroute('**/api/segments/modify'); await page.getByRole('button', { name: '关联', exact: true }).click();
  await page.getByLabel('关联素材', { exact: true }).selectOption(asset.id); await page.getByRole('button', { name: '保存关联与起点', exact: true }).click();
  await page.getByRole('button', { name: '更改', exact: true }).click();
  await page.getByLabel('关联素材', { exact: true }).selectOption(''); await page.getByRole('button', { name: '保存关联与起点', exact: true }).click();
  await expect(page.getByRole('complementary')).toContainText('未关联视频');
  expect((await project.status()).snapshot.segments[0]!.video).toBeNull();
  await page.keyboard.press('Escape'); await expect(page.locator(`[row-id="${id}"] [data-row-details]`)).toBeFocused();
});

test('关联保存中取消不撤回已提交数据，迟到响应不抢新查找或复活子层', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await page.goto(project.url); await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  await page.getByRole('button', { name: '关联', exact: true }).click();
  await page.getByLabel('关联素材', { exact: true }).selectOption(asset.id);
  const gate = await holdResponse(page, '/api/segments/modify');
  try {
    await page.getByRole('button', { name: '保存关联与起点', exact: true }).click(); await gate.received;
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '查找', exact: true }).click(); await page.getByLabel('查找文案', { exact: true }).fill('新条件');
  } finally { gate.release(); }
  await gate.delivered; await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
  expect((await project.status()).snapshot.segments[0]!.video?.assetId).toBe(asset.id);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
});

for (const entry of ['关联', '导入本地视频'] as const) test(`${entry}申请迟到仍接收项目快照，保留查找焦点并释放修改权`, async ({ page, project }) => {
  const [id] = await project.seed(['原文案']); await page.goto(project.url);
  if (entry === '关联') await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  else await page.getByRole('button', { name: '更多', exact: true }).click();
  // 挂起全部状态轮询；只有迟到的修改权申请能把新快照带回面板。
  let releaseStatus!: () => void;
  const statusWaiting = new Promise<void>(resolve => { releaseStatus = resolve; });
  await page.route('**/api/status', async route => { await statusWaiting; await route.continue(); });
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await page.getByRole('button', { name: entry, exact: true }).click(); await gate.received;
    await project.modify({ changes: [{ kind: 'edit', expected: (await project.status()).snapshot.segments[0]!, text: '外部更新文案' }] });
    await page.getByRole('button', { name: '查找', exact: true }).click();
    const search = page.getByLabel('查找文案', { exact: true }); await search.fill('文案');
    gate.release(); await gate.answered;
    await expect.poll(async () => (await project.status()).modification).toBeNull();
    await expect(page.locator(`[row-id="${id}"] [col-id="text"] .text-summary`)).toHaveText('外部更新文案');
    await expect(search).toBeFocused(); await expect(search).toHaveValue('文案');
    await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '导入本地视频', exact: true })).toHaveCount(0);
  } finally { gate.release(); releaseStatus(); }
});

test('取消等待中的关联申请后旧修改权释放，父详情仍可连续关闭', async ({ page, project }) => {
  const [id] = await project.seed(['A']); await page.goto(project.url);
  await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await page.getByRole('button', { name: '关联', exact: true }).click(); await gate.received;
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByLabel('查找文案', { exact: true }).fill('新条件');
    await page.getByRole('complementary').getByRole('heading', { name: '画面素材', exact: true }).click();
    await page.getByRole('complementary').focus();
  } finally { gate.release(); }
  await gate.answered; await expect.poll(async () => (await project.status()).modification).toBeNull();
  await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary')).toBeFocused();
  await page.getByRole('button', { name: '关闭查找', exact: true }).click();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${id}"] [data-row-details]`)).toBeFocused();
});

test('导入明确失败释放修改权，已提交导入取消后迟到响应不触碰新编辑租约', async ({ page, project, mediaFiles }) => {
  await project.seed(['A']); await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '导入本地视频', exact: true }).click();
  await page.getByLabel('视频文件绝对路径', { exact: true }).fill('/missing-source.mp4');
  await page.getByRole('button', { name: '导入并复制', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导入本地视频', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('操作异常', { exact: true })).toContainText('ENOENT');
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '导入本地视频', exact: true }).click();
  await page.getByLabel('视频文件绝对路径', { exact: true }).fill(mediaFiles.video);
  const gate = await holdResponse(page, '/api/video/import');
  try {
    await page.getByRole('button', { name: '导入并复制', exact: true }).click(); await gate.received;
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '导入本地视频', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await project.status()).modification).toBeNull();
    await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '导出设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑设置', exact: true }).click();
    await expect(page.getByLabel('导出帧率', { exact: true })).toBeEnabled();
  } finally { gate.release(); }
  await gate.delivered; await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('dialog', { name: '导入本地视频', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('导出帧率', { exact: true })).toBeEnabled();
  expect((await project.status()).modification?.owner).toBe('user');
  expect((await project.status()).snapshot.assets).toHaveLength(1);
});

test('关联失败的待返回帧不能穿透新音频模态，父来源仍可关闭', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await project.modify({ changes: [{ kind: 'video', expected: (await project.status()).snapshot.segments[0]!, assetId: asset.id, start: 0 }] });
  await page.goto(project.url); await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  await page.getByRole('button', { name: '更改', exact: true }).click();
  await page.route('**/api/segments/modify', route => route.fulfill({ status: 500, json: { error: '本例关联失败' } }));
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: '保存关联与起点', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
  // 原生时钟冻结的是关闭后的恢复帧；新模态以真实键盘获得焦点。
  await page.getByRole('button', { name: '保留音频', exact: true }).press('Enter');
  const history = page.getByRole('dialog', { name: '配音详情与保留音频', exact: true }); await expect(history).toBeVisible();
  await page.clock.runFor(100); await expect.poll(() => history.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.clock.resume(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${id}"] [data-row-details]`)).toBeFocused();
  expect((await project.status()).snapshot.segments[0]!.video?.assetId).toBe(asset.id);
});

test('离开面板期间断线关闭关联子层，返回不补执行旧恢复', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); await importVideo(project.url, mediaFiles.video);
  await page.goto(project.url); await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  await page.getByRole('button', { name: '关联', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toBeFocused();
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  // 这是生命周期事件接线，真实重启负责使产品NDJSON编辑连接断开。
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await project.restart(async () => {
    await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
    // 固定一次离线轮询，避免本例是否清空表格取决于重启速度。
    await page.clock.runFor(1000);
    await expect(page.getByRole('alert').filter({ hasText: '服务连接失败' })).toBeVisible();
  });
  await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
  const before = await page.evaluateHandle(() => document.activeElement);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.clock.runFor(100);
  expect(await page.evaluate(node => document.activeElement === node, before)).toBe(true);
  await page.clock.resume();
  // 离线轮询会清空表格；先等真实重连恢复来源，再验证主动关闭的返回焦点。
  const trigger = page.locator(`[row-id="${id}"] [data-row-details]`);
  await expect(trigger).toBeVisible();
  expect(await page.evaluate(node => document.activeElement === node, before)).toBe(true); await before.dispose();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(trigger).toBeFocused();
});

test('预览期间目标删除后子层仍回父详情，空表关闭采用页面后备', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await project.modify({ changes: [{ kind: 'video', expected: (await project.status()).snapshot.segments[0]!, assetId: asset.id, start: 0 }] });
  await page.goto(project.url); await page.locator(`[row-id="${id}"] [data-row-details]`).press('Enter');
  await page.getByRole('button', { name: '播放预览', exact: true }).press('Enter');
  await project.modify({ changes: [{ kind: 'delete', expected: (await project.status()).snapshot.segments[0]! }] });
  await expect(page.locator('aside[aria-label="口播片段详情"]')).toContainText('片段已删除');
  await page.getByRole('button', { name: '关闭预览', exact: true }).press('Enter');
  await expect(page.getByRole('complementary', { name: '口播片段详情', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '查找', exact: true })).toBeFocused();
});
