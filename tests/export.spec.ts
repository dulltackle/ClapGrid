import { selectTestStyle } from './helpers/project-style.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/media-project.js';
import { queryVisualContext, importVideo, queryExports, queryExportSettings, querySpeech, saveExportSettings, submitSpeech } from '../src/shared/client.js';

for (const viewport of [{ width: 1600, height: 1000 }, { width: 420, height: 360 }]) test(`全片导出错误跨任务详情及连接恢复持续可见 ${viewport.width}`, async ({ page, project }) => {
  await selectTestStyle(project.url);
  const [a] = await project.seed(['A', '未匹配片段']); await page.setViewportSize(viewport); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  await page.getByRole('button', { name: '查找', exact: true }).click(); await page.getByLabel('查找文案', { exact: true }).fill('A');
  await expect(page.locator('#export-scope')).toContainText('查找与勾选不改变范围');
  const requests: unknown[] = [];
  await page.route('**/api/exports/submit', async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ status: 409, json: { error: '本例导出被拒绝' } }); });
  await page.getByRole('button', { name: '导出全片', exact: true }).click();
  const errors = page.locator('footer'); await expect(errors).toContainText('本例导出被拒绝');
  await page.route('**/api/exports', route => route.fulfill({ status: 500, json: { error: '查询失败' } }));
  await page.route('**/api/status', route => route.fulfill({ status: 500, json: { error: '断线' } }));
  await expect(errors).toContainText('读取导出任务失败'); await expect(errors).toContainText('服务连接失败');
  await page.unroute('**/api/exports'); await page.unroute('**/api/status');
  await expect(errors).not.toContainText('读取导出任务失败'); await expect(errors).not.toContainText('服务连接失败');
  await expect(errors).toContainText('本例导出被拒绝');
  await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '任务记录', exact: true }).click();
  await page.getByRole('button', { name: '关闭任务记录', exact: true }).click(); await expect(errors).toContainText('本例导出被拒绝');
  await page.unroute('**/api/exports/submit'); await page.getByRole('button', { name: '导出全片', exact: true }).click();
  await expect(errors).not.toContainText('本例导出被拒绝');
  await expect.poll(async () => (await queryExports(project.url)).tasks[0]?.state).toBe('failed');
  expect(requests).toEqual([{}]);
  const task = (await queryExports(project.url)).tasks[0]!;
  expect(task.issues.filter(issue => issue.segmentId).map(issue => issue.segmentId)).toContain((await project.status()).snapshot.segments[1]!.id);
  await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '任务记录', exact: true }).click();
  const tasks = page.getByRole('dialog', { name: '任务记录' });
  await expect(tasks.getByRole('region', { name: '待处理问题' })).toContainText('导出失败');
  await expect(tasks).not.toContainText(task.id);
});

test('真实成片的兼容预览在 Chrome 播放，下载原片一致，关闭任务记录后恢复键盘焦点', async ({ page, project, mediaFiles }, testInfo) => {
  test.slow();
  const [id] = await project.seed(['真实成片']); const { asset } = await importVideo(project.url, mediaFiles.video);
  await project.modify({ changes: [{ kind: 'video', expected: (await project.status()).snapshot.segments[0]!, assetId: asset.id, start: 1 }] });
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  await selectTestStyle(project.url);
  const details = await queryExportSettings(project.url);
  await saveExportSettings(project.url, { expected: details.settings, settings: { ...details.settings, codec: 'libx264', fps: 24 } });
  const context = await queryVisualContext(project.url, id!);
  await project.modify({ changes: [{ kind: 'composition', expected: context.segment, plan: { duration: context.duration, layers: [{ assetId: asset.id, role: 'background', from: 0, to: context.duration, start: 1, x: 0, y: 0, width: 1, height: 1, z: 0 }] } }] });
  await page.goto(project.url); await page.getByRole('button', { name: '导出全片', exact: true }).click();
  await expect.poll(async () => (await queryExports(project.url)).tasks[0]?.state, { timeout: 30000 }).toBe('succeeded');
  const task = (await queryExports(project.url)).tasks[0]!; expect(task.output).toBeTruthy();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '任务记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '任务记录', exact: true });
  await dialog.locator('summary').filter({ hasText: '导出成功' }).click();
  const open = page.getByRole('link', { name: '打开成片', exact: true }); const download = page.getByRole('link', { name: '下载 MP4 原片', exact: true });
  await expect(dialog).not.toContainText(task.id);
  await expect(open).toHaveCSS('text-decoration-line', 'underline');
  const previewUrl = new URL(task.output!.previewUrl!, project.url).href;
  const popupPromise = page.waitForEvent('popup');
  await open.click();
  const popup = await popupPromise;
  try {
    await expect(popup).toHaveURL(previewUrl);
    await expectPreviewPlaying(popup);
  } finally { await popup.close(); }

  const downloadPromise = page.waitForEvent('download');
  await download.click();
  const downloaded = await downloadPromise;
  expect(await downloaded.failure()).toBeNull();
  expect(downloaded.suggestedFilename()).toMatch(/\.mp4$/i);
  const downloadedPath = testInfo.outputPath('成片.mp4');
  await downloaded.saveAs(downloadedPath);
  const [actual, expected] = await Promise.all([readFile(downloadedPath), readFile(task.output!.path)]);
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(createHash('sha256').update(actual).digest('hex')).toBe(createHash('sha256').update(expected).digest('hex'));
  await expect(dialog.getByRole('button', { name: '连接诊断' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
});

test('只有成功的全片导出任务显示成片响度，并区分全片和片段警告', async ({ page, project }) => {
  const base = { createdAt: '2026-11-08T00:00:00Z', state: 'succeeded', completed: 1, total: 1, message: '制作成功', issues: [], warnings: [] };
  const measured = { integratedLufs: -14.02, truePeakDbtp: -1.58, rangeLu: 3 };
  const technicalChecks = { loudnessBefore: measured, loudnessAfter: measured, blackIntervals: [] };
  await page.route('**/api/exports', route => route.fulfill({ json: { locked: false, tasks: [
    { ...base, id: '旧导出', output: { path: '旧成片.mp4', url: '/old.mp4' } },
    { ...base, id: '新导出', output: { path: '新成片.mp4', url: '/new.mp4' }, technicalChecks, warnings: [{ field: 'project', message: '响度偏离目标' }, { order: 1, field: 'video', message: '检测到黑场' }] },
  ] } }));
  await page.route('**/api/visual-previews', route => route.fulfill({ json: { locked: false, tasks: [
    { ...base, id: '预览', current: true, preview: { segmentId: '预览片段', input: '' } },
  ] } }));
  await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '任务记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '任务记录', exact: true });
  const completed = dialog.getByRole('region', { name: '已完成成片' });
  const current = completed.locator('details').first();
  const legacy = completed.locator('details').last();
  await expect(completed.locator('summary')).toHaveCount(2);
  for (const card of [current, legacy]) await card.locator('summary').click();
  await expect(current.getByRole('link', { name: '打开成片' })).toHaveAttribute('href', '/new.mp4');
  await expect(legacy.getByRole('link', { name: '打开成片' })).toHaveAttribute('href', '/old.mp4');
  await expect(dialog).not.toContainText('预览片段');
  await expect(current.getByText('成片响度 −14.0 LUFS · 真峰值 −1.6 dBTP', { exact: true })).toBeVisible();
  await expect(current.getByText('全片：响度偏离目标', { exact: true })).toBeVisible();
  await expect(current.getByText('片段 1：检测到黑场', { exact: true })).toBeVisible();
  await expect(legacy.getByText('成片响度')).toHaveCount(0);
});

import { submitExport } from '../src/shared/client.js';
import { holdResponse } from './helpers/response-gate.js';

test('取消错误跨详情和连接恢复保留，重试期间禁用并在成功后清除', async ({ page, project }) => {
  await selectTestStyle(project.url);
  await project.seed(['A']); await submitExport(project.url);
  await expect.poll(async () => (await queryExports(project.url)).locked).toBe(false);
  // 仅把真实任务的展示状态固定为rendering以控制取消交互；真实取消/进程清理由现有服务与#198专项覆盖。
  await page.route('**/api/exports', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, locked: true, tasks: body.tasks.map((task: object) => ({ ...task, state: 'rendering', completed: 1, total: 2 })) } });
  });
  await page.goto(project.url); await page.getByRole('button', { name: '任务详情', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '任务记录', exact: true });
  await expect(dialog.getByRole('region', { name: '进行中' })).toContainText('导出 1/2');
  await page.route('**/api/exports/cancel', route => route.fulfill({ status: 500, json: { error: '本例取消导出失败' } }));
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('本例取消导出失败');
  await page.getByRole('button', { name: '关闭任务记录', exact: true }).click();
  await expect(page.locator('footer')).toContainText('本例取消导出失败');
  await page.route('**/api/exports', route => route.fulfill({ status: 500, json: { error: '断线' } }));
  await expect(page.locator('footer')).toContainText('读取导出任务失败');
  await page.unroute('**/api/exports');
  await expect(page.locator('footer')).not.toContainText('读取导出任务失败');
  await expect(page.locator('footer')).toContainText('本例取消导出失败');
  await page.getByRole('button', { name: '任务详情', exact: true }).click();
  // 恢复真实终态后仍核对错误；为重试按钮最后一次明确展示rendering状态。
  await page.route('**/api/exports', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, tasks: body.tasks.map((task: object) => ({ ...task, state: 'rendering' })) } });
  });
  await page.unroute('**/api/exports/cancel');
  const gate = await holdResponse(page, '/api/exports/cancel');
  try {
    await page.getByRole('button', { name: '取消导出', exact: true }).click(); await gate.received;
    await expect(page.getByRole('button', { name: '取消导出', exact: true })).toBeDisabled();
    await expect(dialog).toBeFocused();
  } finally { gate.release(); }
  await gate.delivered;
  await expect(page.locator('footer')).not.toContainText('本例取消导出失败');
});

/** 只验证播放能力；媒体文档不自动播放时主动 play()，不验证自动播放策略。 */
async function expectPreviewPlaying(page: Page) {
  const video = page.locator('video');
  await video.evaluate(node => (node as HTMLVideoElement).play());
  await expect.poll(() => video.evaluate(node => {
    const media = node as HTMLVideoElement;
    return media.readyState >= 2 && !media.paused;
  })).toBe(true);
  // 配音 fixture 是两秒正弦音；成片按配音时长生成，允许音频及视频帧边界误差。
  expect(await video.evaluate(node => (node as HTMLVideoElement).duration)).toBeCloseTo(2, 1);
  const startedAt = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(startedAt + 0.2);
}
