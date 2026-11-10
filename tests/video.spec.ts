import { test, expect } from './helpers/media-project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';
import { importVideo } from '../src/shared/client.js';

for (const viewport of [{ width: 1600, height: 1000 }, { width: 420, height: 360 }]) test(`真实视频导入关联、缩略图解码和原生预览 ${viewport.width}`, async ({ page, project, mediaFiles }) => {
  await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' });
  const [id] = await project.seed(['视频片段']); await page.goto(project.url);
  await page.getByRole('button', { name: /片段 1 画面素材/ }).click();
  await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await expect(page.getByRole('button', { name: '加入本句', exact: true })).toBeDisabled();
  await page.getByLabel('本地素材绝对路径', { exact: true }).fill(mediaFiles.video);
  await page.getByRole('button', { name: '加入本句', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
  const asset = (await project.status()).snapshot.assets[0]!;
  expect(asset.duration).toBeCloseTo(4, 1);
  expect((await project.status()).snapshot.segments[0]!.materials).toEqual([asset.id]);
  await expect.poll(() => page.getByRole('button', { name: '播放原件 实际素材.mp4', exact: true }).locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '播放原件 实际素材.mp4', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '视频原件', exact: true }); const video = dialog.locator('video');
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState >= 2 && !(node as HTMLVideoElement).paused && (node as HTMLVideoElement).currentTime >= 0)).toBe(true);
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
  await expect(page.getByRole('button', { name: '播放原件 实际素材.mp4', exact: true })).toBeFocused();
});

test('关联保存失败关闭弹窗保留行来源，可重新关联并解除', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await page.goto(project.url);
  if (await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).count() === 0) await page.getByRole('button', { name: /片段 1 画面素材/ }).click(); await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await page.getByLabel('项目素材', { exact: true }).selectOption(asset.id);
  await page.route('**/api/segments/modify', route => route.fulfill({ status: 500, json: { error: '本例关联失败' } }));
  await page.getByRole('button', { name: '加入本句', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('操作异常', { exact: true })).toContainText('本例关联失败');
  await expect(page.locator('[data-save-status]')).toHaveCount(0);
  expect((await project.status()).snapshot.segments[0]!.video).toBeNull();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await page.unroute('**/api/segments/modify'); if (await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).count() === 0) await page.getByRole('button', { name: /片段 1 画面素材/ }).click(); await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await page.getByLabel('项目素材', { exact: true }).selectOption(asset.id); await page.getByRole('button', { name: '加入本句', exact: true }).click();
  await page.getByRole('button', { name: '移出本句 实际素材.mp4', exact: true }).click();
  await expect(page.getByRole('button', { name: '片段 1 画面素材（0）', exact: true })).toBeVisible();
  expect((await project.status()).snapshot.segments[0]!.materials).toEqual([]);
  await expect(page.getByRole('button', { name: '片段 1 画面素材（0）', exact: true })).toBeFocused();
});

test('关联保存中取消不撤回已提交数据，迟到响应不抢新查找或复活子层', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await page.goto(project.url);
  if (await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).count() === 0) await page.getByRole('button', { name: /片段 1 画面素材/ }).click(); await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await page.getByLabel('项目素材', { exact: true }).selectOption(asset.id);
  const gate = await holdResponse(page, '/api/segments/modify');
  try {
    await page.getByRole('button', { name: '加入本句', exact: true }).click(); await gate.received;
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '查找', exact: true }).click(); await page.getByLabel('查找文案', { exact: true }).fill('新条件');
  } finally { gate.release(); }
  await gate.delivered; await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
  expect((await project.status()).snapshot.segments[0]!.materials).toEqual([asset.id]);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
});

test('关联申请迟到仍接收项目快照，保留查找焦点并释放修改权', async ({ page, project }) => {
  const [id] = await project.seed(['原文案']); await page.goto(project.url);
  await page.getByRole('button', { name: /片段 1 画面素材/ }).click();
  // 挂起全部状态轮询；只有迟到的修改权申请能把新快照带回面板。
  let releaseStatus!: () => void;
  const statusWaiting = new Promise<void>(resolve => { releaseStatus = resolve; });
  await page.route('**/api/status', async route => { await statusWaiting; await route.continue(); });
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click(); await gate.received;
    await project.modify({ changes: [{ kind: 'edit', expected: (await project.status()).snapshot.segments[0]!, text: '外部更新文案' }] });
    await page.getByRole('button', { name: '查找', exact: true }).click();
    const search = page.getByLabel('查找文案', { exact: true }); await search.fill('文案');
    gate.release(); await gate.answered;
    await expect.poll(async () => (await project.status()).modification).toBeNull();
    await expect(page.locator(`[row-id="${id}"] [col-id="text"] .text-summary`)).toHaveText('外部更新文案');
    await expect(search).toBeFocused(); await expect(search).toHaveValue('文案');
    await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
  } finally { gate.release(); releaseStatus(); }
});

test('导入明确失败释放修改权，已提交导入取消后迟到响应不触碰新编辑租约', async ({ page, project, mediaFiles }) => {
  await project.seed(['A']); await page.goto(project.url);
  if (!await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).isVisible()) await page.getByRole('button', { name: /片段 1 画面素材/ }).click();
  await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await page.getByLabel('本地素材绝对路径', { exact: true }).fill('/missing-source.mp4');
  await page.getByRole('button', { name: '加入本句', exact: true }).click();
  await expect(page.getByLabel('操作异常', { exact: true })).toContainText('ENOENT');
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  if (!await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).isVisible()) await page.getByRole('button', { name: /片段 1 画面素材/ }).click();
  await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await page.getByLabel('本地素材绝对路径', { exact: true }).fill(mediaFiles.video);
  const gate = await holdResponse(page, '/api/material/import');
  try {
    await page.getByRole('button', { name: '加入本句', exact: true }).click(); await gate.received;
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await project.status()).modification).toBeNull();
    await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '导出设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑设置', exact: true }).click();
    await expect(page.getByLabel('导出帧率', { exact: true })).toBeEnabled();
  } finally { gate.release(); }
  await gate.delivered; await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('导出帧率', { exact: true })).toBeEnabled();
  expect((await project.status()).modification?.owner).toBe('user');
  const { snapshot } = await project.status();
  expect(snapshot.assets).toHaveLength(1);
  expect(snapshot.segments[0]!.materials).toBeUndefined();
});

test('离开面板期间断线关闭关联子层，返回不补执行旧恢复', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); await importVideo(project.url, mediaFiles.video);
  await page.goto(project.url);
  if (await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).count() === 0) await page.getByRole('button', { name: /片段 1 画面素材/ }).click(); await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toBeFocused();
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  // 这是生命周期事件接线，真实重启负责使产品NDJSON编辑连接断开。
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await project.restart(async () => {
    await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
    // 固定一次离线轮询，避免本例是否清空表格取决于重启速度。
    await page.clock.runFor(1000);
    await expect(page.getByRole('alert').filter({ hasText: '服务连接失败' })).toBeVisible();
  });
  await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toHaveCount(0);
  const before = await page.evaluateHandle(() => document.activeElement);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.clock.runFor(100);
  expect(await page.evaluate(node => document.activeElement === node, before)).toBe(true);
  await page.clock.resume();
  // 重连不自动重开旧浮层或抢焦点；用户再次打开后才恢复其中的添加入口。
  const tray = page.getByRole('button', { name: /片段 1 画面素材/ });
  await expect(tray).toBeVisible();
  await expect(page.getByRole('dialog', { name: '片段 1 素材面板', exact: true })).toHaveCount(0);
  expect(await page.evaluate(node => document.activeElement === node, before)).toBe(true); await before.dispose();
  await tray.press('Enter');
  const trigger = page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('dialog', { name: '添加画面素材', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('预览期间目标删除后预览关闭，空表采用页面后备', async ({ page, project, mediaFiles }) => {
  const [id] = await project.seed(['A']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await project.modify({ changes: [{ kind: 'video', expected: (await project.status()).snapshot.segments[0]!, assetId: asset.id, start: 0 }] });
  await page.goto(project.url);
  await page.getByRole('button', { name: /片段 1 画面素材/ }).click();
  await page.getByRole('button', { name: '播放原件 实际素材.mp4', exact: true }).press('Enter');
  await project.modify({ changes: [{ kind: 'delete', expected: (await project.status()).snapshot.segments[0]! }] });
  await expect(page.locator(`[row-id="${id}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: '关闭预览', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: '查找', exact: true })).toBeFocused();
});
