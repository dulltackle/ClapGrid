import { randomUUID } from 'node:crypto';
import { test, expect } from './helpers/media-project.js';
import { importVideo, querySpeech, submitSpeech } from '../src/shared/client.js';

for (const environment of ['wide', 'compact', 'touch'] as const) test.describe(environment, () => {
  test.use({ viewport: environment === 'wide' ? { width: 1200, height: 800 } : { width: 780, height: 579 }, hasTouch: environment === 'touch', isMobile: environment === 'touch' });
  test('行内素材菜单键盘更改与解除，试听拖动与键盘进度，全表单条播放', async ({ page, project, mediaFiles }) => {
    const [a, b] = await project.seed(['A', 'B']);
    const { asset } = await importVideo(project.url, mediaFiles.video);
    for (const id of [a!, b!]) {
      await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id });
      await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
    }
    await page.goto(project.url);
    const row = page.locator(`[row-id="${a}"]`);
    await row.getByRole('button', { name: '关联画面', exact: true }).press('Enter');
    await page.getByLabel('关联素材', { exact: true }).selectOption(asset.id);
    await page.getByRole('button', { name: '保存关联与起点', exact: true }).press('Enter');
    await row.getByRole('button', { name: '播放 实际素材.mp4', exact: true }).press('Enter');
    await expect(page.getByRole('dialog', { name: '视频预览', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    await row.getByRole('button', { name: '片段 1 画面操作', exact: true }).press('Enter');
    await page.getByRole('menuitem', { name: '更改', exact: true }).press('Enter');
    await page.getByLabel('播放起点（秒）', { exact: true }).fill('1');
    await page.getByRole('button', { name: '保存关联与起点', exact: true }).press('Enter');
    await expect.poll(async () => (await project.status()).snapshot.segments[0]!.video?.start).toBe(1);
    await row.getByRole('button', { name: '片段 1 画面操作', exact: true }).press('Enter');
    await page.getByRole('menuitem', { name: '解除关联', exact: true }).press('Enter');
    await expect(row.getByRole('button', { name: '关联画面', exact: true })).toBeVisible();
    await row.getByRole('button', { name: '试听', exact: true }).press('Enter');
    const player = page.locator('main > audio');
    await expect.poll(() => player.evaluate(node => (node as HTMLAudioElement).readyState)).toBeGreaterThan(0);
    await row.getByRole('button', { name: '暂停试听', exact: true }).press('Enter');
    const slider = row.getByRole('slider', { name: '配音进度', exact: true });
    await slider.press('Home'); await slider.press('ArrowRight');
    await expect.poll(() => player.evaluate(node => (node as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
    const bounds = (await slider.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width * .6, bounds.y + bounds.height / 2);
    await expect.poll(() => player.evaluate(node => (node as HTMLAudioElement).currentTime)).toBeGreaterThan(.5);
    await page.locator(`[row-id="${b}"]`).getByRole('button', { name: '试听', exact: true }).press('Enter');
    await expect(row.getByRole('slider')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: '配音进度', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '停止试听', exact: true }).press('Enter');
    await expect(page.getByRole('slider')).toHaveCount(0);
  });
});

test('结果未知错误可点击查看，重试提示可能计费且取消不提交', async ({ page, project, speechControl }) => {
  const [id] = await project.seed(['A']); speechControl.mode = 'unknown';
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).tasks[0]?.state).toBe('unknown');
  await page.goto(project.url);
  await page.getByRole('button', { name: '结果未知，查看错误说明', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: '配音详情与保留音频', exact: true })).toContainText('可能已计费');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重试', exact: true }).press('Enter');
  const confirmation = page.getByRole('alertdialog'); await expect(confirmation).toContainText('可能已计费');
  await confirmation.getByRole('button', { name: '取消', exact: true }).press('Enter');
  expect(speechControl.requests).toHaveLength(1);
  speechControl.mode = 'success';
  await page.getByRole('button', { name: '重试', exact: true }).press('Enter');
  await confirmation.getByRole('button', { name: '确认重试', exact: true }).press('Enter');
  await expect.poll(() => speechControl.requests.length).toBe(2);
  await expect(page.getByRole('button', { name: '试听', exact: true })).toBeVisible();
});
