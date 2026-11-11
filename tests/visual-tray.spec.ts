import { test, expect } from './helpers/media-project.js';
import { importMaterial, querySpeech, queryVisualContext, submitSpeech } from '../src/shared/client.js';
import { execCommand } from './helpers/command.js';
import { join } from 'node:path';

for (const viewport of [{ width: 780, height: 579 }, { width: 420, height: 360 }]) test(`片段素材托盘只编辑本句归属并查看图片原件 ${viewport.width}`, async ({ page, project, mediaFiles }) => {
  await page.setViewportSize(viewport);
  await project.seed(['第一句', '第二句']);
  const image = join(project.directory, '透明角色.png');
  await execCommand('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red@0.5:s=64x64,format=rgba', '-frames:v', '1', image]);
  await importMaterial(project.url, mediaFiles.video);
  await page.goto(project.url);
  const tray = page.getByRole('button', { name: '片段 1 画面素材（0）', exact: true });
  const firstRow = page.locator('.ag-row[row-id]').first();
  const initialHeight = await firstRow.evaluate(e => e.getBoundingClientRect().height);
  await tray.press('Enter');
  await expect(page.getByRole('dialog', { name: '片段 1 素材面板', exact: true })).toBeVisible();
  expect(await firstRow.evaluate(e => e.getBoundingClientRect().height)).toBe(initialHeight);
  await page.locator('header h1').click();
  await expect(page.getByRole('dialog', { name: '片段 1 素材面板', exact: true })).toHaveCount(0);
  await tray.click();
  await page.getByRole('button', { name: '为片段 1 添加画面素材', exact: true }).click();
  await page.getByLabel('本地素材绝对路径', { exact: true }).fill(image);
  await page.getByRole('button', { name: '加入本句', exact: true }).click();
  await expect(page.getByText('透明角色.png', { exact: true })).toBeVisible();
  const materialPanel = page.getByRole('dialog', { name: '片段 1 素材面板', exact: true });
  await expect(materialPanel).not.toContainText('第一句');
  await expect.poll(async () => (await materialPanel.boundingBox())!.width).toBeLessThanOrEqual(Math.min(452, viewport.width - 24));
  const thumbnailEntry = page.getByRole('button', { name: '片段 1 画面素材（1）', exact: true });
  await expect(thumbnailEntry.locator('img')).toBeVisible();
  await expect.poll(() => thumbnailEntry.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '重命名素材 透明角色.png', exact: true }).click();
  await page.getByLabel('素材名称', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: '保存名称', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '重命名素材 透明角色.png', exact: true }).click();
  await page.getByLabel('素材名称', { exact: true }).fill('清晨角色.png');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '重命名素材', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重命名素材 清晨角色.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看原件 清晨角色.png', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '图片原件', exact: true });
  await expect(dialog.getByRole('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '移出本句 清晨角色.png', exact: true }).click();
  await expect(page.getByRole('button', { name: '片段 1 画面素材（0）', exact: true })).toBeVisible();
  expect((await project.status()).snapshot.assets).toHaveLength(2);
  expect((await project.status()).snapshot.segments[1]?.materials ?? []).toEqual([]);
  await expect(page.getByLabel('播放起点（秒）')).toHaveCount(0);
});

test('片段合成预览真实播放，内容变化后显示待更新且不能冒充当前结果', async ({ page, project, mediaFiles }) => {
  const { previewSegment, queryVisualPreviews, saveExportSettings } = await import('../src/shared/client.js');
  const [id] = await project.seed(['本句合成效果', '等待编排']);
  const { asset } = await importMaterial(project.url, mediaFiles.video);
  await submitSpeech(project.url, { requestId: crypto.randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  await project.modify({ changes: [{ kind: 'materials', expected: (await project.status()).snapshot.segments[0]!, assetIds: [asset.id] }] });
  const context = await queryVisualContext(project.url, id!);
  await project.modify({ changes: [{ kind: 'composition', expected: context.segment, plan: { duration: context.duration, layers: [{ assetId: asset.id, role: 'background', from: 0, to: context.duration, start: 0, x: 0, y: 0, width: 1, height: 1, z: 0 }] } }] });
  await saveExportSettings(project.url, { expected: (await project.status()).snapshot.exportSettings, settings: { codec: 'libx264', fps: 25 } });
  await page.goto(project.url);
  await expect(page.getByRole('button', { name: '片段 1 画面素材（1）' })).toBeVisible();
  await expect(page.getByRole('button', { name: /合成预览，已就绪/ })).toHaveCount(0);
  await expect(page.getByText('待更新', { exact: true })).toHaveCount(0);
  await previewSegment(project.url, id!);
  await expect.poll(async () => (await queryVisualPreviews(project.url)).tasks[0]?.state, { timeout: 30000 }).toBe('succeeded');
  const ready = page.getByRole('button', { name: '播放片段 1 合成预览，已就绪' });
  await expect(page.getByRole('button', { name: /合成预览，已就绪/ })).toHaveCount(1);
  await ready.press('Enter');
  await expect(page.getByRole('dialog', { name: '片段合成预览', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ready).toBeFocused();
  await ready.click();
  const dialog = page.getByRole('dialog', { name: '片段合成预览', exact: true });
  await expect(dialog).toContainText('未设置项目风格，预览不含字幕');
  await expect.poll(() => dialog.locator('video').evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await project.modify({ changes: [{ kind: 'edit', expected: (await project.status()).snapshot.segments[0]!, text: '改为特写' }] });
  await expect(dialog).toContainText('此预览待更新');
  await page.keyboard.press('Escape');
  await expect(ready).toHaveCount(0);
  const materials = page.getByRole('button', { name: /片段 1 画面素材/ });
  await expect(materials).toBeFocused();
  await expect(page.getByText('待更新', { exact: true })).toBeVisible();
  await materials.press('Enter');
  await expect(page.getByRole('button', { name: '片段合成预览', exact: true })).toBeDisabled();
});

test('派生素材显示来源标记，并可逐级查看未关联本句的输入素材', async ({ page, project }) => {
  const [segmentId] = await project.seed(['本句使用派生素材']);
  const sourcePath = join(project.directory, '原素材.png');
  await execCommand('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=32x32', '-frames:v', '1', sourcePath]);
  const { asset: original } = await importMaterial(project.url, sourcePath);
  const declaration = { executor: 'codex-imagegen', model: 'gpt-image-2' };
  const { asset: cutout } = await importMaterial(project.url, { sourcePath, derivation: {
    ...declaration, method: 'matte', prompt: '提取主体', inputs: [original.id],
  } });
  const { asset: illustration } = await importMaterial(project.url, { sourcePath, derivation: {
    ...declaration, method: 'edit', prompt: '画成水彩插图', inputs: [cutout.id],
  } });
  await project.modify({ changes: [{ kind: 'materials', expected: (await project.status()).snapshot.segments[0]!, assetIds: [illustration.id] }] });

  await submitSpeech(project.url, { requestId: crypto.randomUUID(), segmentId: segmentId! });
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  expect((await queryVisualContext(project.url, segmentId!)).assets).toEqual([illustration]);

  await page.goto(project.url);
  await page.getByRole('button', { name: '片段 1 画面素材（1）', exact: true }).click();
  const tray = page.getByRole('dialog', { name: '片段 1 素材面板', exact: true });
  await tray.getByText('编辑', { exact: true }).click();
  await expect(tray.getByText('画成水彩插图', { exact: true })).toBeVisible();
  await tray.getByRole('button', { name: '查看输入素材 原素材.png' }).click();
  const preview = page.getByRole('dialog', { name: '图片原件', exact: true });
  await expect(preview.getByRole('img')).toHaveAttribute('src', new RegExp(cutout.id));
  await preview.getByText('抠图', { exact: true }).click();
  await preview.getByRole('button', { name: '查看输入素材 原素材.png' }).click();
  await expect(preview.getByRole('img')).toHaveAttribute('src', new RegExp(original.id));
  await preview.getByRole('button', { name: '关闭预览' }).click();
  await expect(tray.getByRole('button', { name: '查看输入素材 原素材.png' })).toBeFocused();
});
