import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from './helpers/media-project.js';
import { startService } from '../src/service/server.js';
import { bindWorkspace } from '../src/workspace-service.js';
import { modifyBatch, queryStatus } from '../src/shared/client.js';

type BoundProject = { url: string; directory: string };

// 复用面板构建和真实媒体输入；不启用轻量 project 或配音供应商 fixture。
const test = base.extend<{ boundProject: BoundProject }>({
  boundProject: async ({ panelDirectory }, use) => {
    const workspace = await mkdtemp(join(tmpdir(), 'clapgrid-bound-panel-'));
    const directory = join(workspace, 'clapgrid');
    const threadId = randomUUID();
    const host = join(workspace, 'host.cjs');
    const previousHost = process.env.CLAPGRID_CODEX_BIN;
    let service: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      // 只控制宿主工作空间查询；服务发现、绑定签发、HTTP、SQLite 和浏览器均真实运行。
      await writeFile(host, `#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    console.log(JSON.stringify({ id: request.id, result: {} }));
  } else if (request.method === 'thread/read') {
    const result = request.params.threadId === ${JSON.stringify(threadId)}
      ? { thread: { id: request.params.threadId, cwd: ${JSON.stringify(workspace)} } }
      : null;
    console.log(JSON.stringify({ id: request.id, result }));
  }
});
`, { mode: 0o700 });
      process.env.CLAPGRID_CODEX_BIN = host;
      service = await startService({ projectDirectory: directory, workspaceDirectory: workspace, panelDirectory, port: 0 });
      const url = await bindWorkspace(workspace, threadId);
      // 防止 fixture 退回无需绑定的服务，从而掩盖浏览器请求丢失绑定前缀。
      expect(new URL(url).pathname).toMatch(/^\/binding\/[^/]+$/);
      expect((await fetch(`${service.url}/api/status`)).status).toBe(409);
      expect((await queryStatus(url)).snapshot.project.directory).toBe(directory);
      await use({ url, directory });
    } finally {
      try {
        await service?.close();
        await rm(workspace, { recursive: true, force: true });
      } finally {
        if (previousHost === undefined) delete process.env.CLAPGRID_CODEX_BIN;
        else process.env.CLAPGRID_CODEX_BIN = previousHost;
      }
    }
  },
});

test('工作空间绑定面板完成文案保存、刷新和本地视频播放', async ({ page, boundProject, mediaFiles }) => {
  const { url, directory } = boundProject;
  await modifyBatch(url, { changes: [{ kind: 'add', text: '原文' }] });
  const segment = (await queryStatus(url)).snapshot.segments[0]!;
  await page.goto(url);

  await test.step('从绑定地址编辑文案，刷新后仍读取已保存内容', async () => {
    await page.locator(`[row-id="${segment.id}"] [data-segment-script]`).click();
    const editor = page.getByLabel('文案全文', { exact: true });
    await editor.fill('工作空间项目中已保存的文案');
    // Enter 后先等本次保存响应，避免把上一次的“已保存”当成当前请求已完成。
    const saved = page.waitForResponse(response => response.url() === `${url}/api/segments/edit` && response.request().method() === 'POST');
    await editor.press('Enter');
    expect((await saved).ok()).toBe(true);
    await expect(page.locator('[data-save-status]')).toHaveText('已保存');
    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(page.locator(`[row-id="${segment.id}"] .text-summary`)).toHaveText('工作空间项目中已保存的文案');
    const status = await queryStatus(url);
    expect(status.snapshot.project.directory).toBe(directory);
    expect(status.snapshot.segments[0]!.text).toBe('工作空间项目中已保存的文案');
  });

  await test.step('通过面板导入本地视频并关联到口播片段', async () => {
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: '导入本地视频', exact: true }).click();
    await page.getByLabel('视频文件绝对路径', { exact: true }).fill(mediaFiles.video);
    await page.getByRole('button', { name: '导入并复制', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '导入本地视频', exact: true })).toHaveCount(0);
    const asset = (await queryStatus(url)).snapshot.assets[0]!;
    await page.locator(`[row-id="${segment.id}"] [data-row-details]`).press('Enter');
    await page.getByRole('button', { name: '关联', exact: true }).click();
    await page.getByLabel('关联素材', { exact: true }).selectOption(asset.id);
    await page.getByRole('button', { name: '保存关联与起点', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '关联视频', exact: true })).toHaveCount(0);
    expect((await queryStatus(url)).snapshot.segments[0]!.video).toEqual({ assetId: asset.id, start: 0 });
  });

  await test.step('绑定地址下的缩略图可解码，真实视频播放时间持续前进', async () => {
    const details = page.getByRole('complementary', { name: '口播片段详情', exact: true });
    const preview = details.getByRole('button', { name: '播放预览', exact: true });
    const thumbnail = preview.locator('img');
    await expect.poll(() => thumbnail.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const thumbnailUrl = await thumbnail.evaluate(node => (node as HTMLImageElement).src);
    expect(thumbnailUrl.startsWith(`${url}/`)).toBe(true);
    await preview.click();
    const video = page.getByRole('dialog', { name: '视频预览', exact: true }).locator('video');
    await expect.poll(() => video.evaluate(node => {
      const media = node as HTMLVideoElement;
      return media.readyState >= 2 && !media.paused;
    })).toBe(true);
    const videoUrl = await video.evaluate(node => (node as HTMLVideoElement).currentSrc);
    expect(videoUrl.startsWith(`${url}/`)).toBe(true);
    expect(await video.evaluate(node => (node as HTMLVideoElement).duration)).toBeCloseTo(4, 1);
    const startedAt = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(startedAt + 0.2);
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  });
});
