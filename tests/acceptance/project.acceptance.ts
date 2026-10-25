import { randomUUID } from 'node:crypto';
import { test, expect } from '../helpers/acceptance.js';
import { importVideo, queryExports, queryExportSettings, querySpeech, saveExportSettings, submitExport, submitSpeech } from '../../src/shared/client.js';

test('空项目', async ({ acceptance, project }) => {
  await acceptance.hold('空项目', project);
});

test('真实成片已导出', async ({ acceptance, project, mediaFiles }) => {
  const [id] = await project.seed(['真实成片']);
  const { asset } = await importVideo(project.url, mediaFiles.video);
  await project.modify({ changes: [{ kind: 'video', expected: (await project.status()).snapshot.segments[0]!, assetId: asset.id, start: 1 }] });
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).locked, { timeout: 30000 }).toBe(false);
  const details = await queryExportSettings(project.url);
  expect(details.fonts.length).toBeGreaterThan(0);
  await saveExportSettings(project.url, { expected: details.settings, settings: { ...details.settings, codec: 'libx264', fps: 24, fontFamily: details.fonts[0]!, fontSize: 32 } });
  const task = await submitExport(project.url);
  await expect.poll(async () => (await queryExports(project.url)).tasks.find(value => value.id === task.id)?.state, { timeout: 60000 }).toMatch(/^(succeeded|failed|cancelled|interrupted)$/);
  const exported = (await queryExports(project.url)).tasks.find(value => value.id === task.id)!;
  expect(exported.state, JSON.stringify(exported)).toBe('succeeded');
  expect(exported.output?.previewUrl).toBeTruthy();
  await acceptance.hold('真实成片已导出', project);
});
