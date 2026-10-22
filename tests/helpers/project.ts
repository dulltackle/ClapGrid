import { test as base, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { startService } from '../../src/service/server.js';
import { modifyBatch, queryStatus } from '../../src/shared/client.js';
import type { BuildIdentity } from '../../src/build-identity.js';
import type { SpeechRuntime } from '../../src/business/speech.js';
import type { Batch } from '../../src/shared/contracts.js';

/** 真实 HTTP/SQLite 项目；浏览器、页面和失败附件完全由 Playwright 管理。 */
export type Project = {
  url: string;
  directory: string;
  seed(texts: string[]): Promise<string[]>;
  modify(batch: Batch): ReturnType<typeof modifyBatch>;
  status(): ReturnType<typeof queryStatus>;
  restart(whileStopped?: () => Promise<void>): Promise<void>;
};
/** 两种启动 adapter 共享项目行为和目录归属；未知启动结果必须保留现场。 */
export async function useProject(options: Omit<Parameters<typeof startService>[0], 'projectDirectory' | 'port'>, start: typeof startService, use: (project: Project) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'clapgrid-browser-'));
  let service: Awaited<ReturnType<typeof startService>> | undefined;
  let released = true;
  let url = '';
  const startAt = async (port: number) => {
    released = false;
    try { service = await start({ ...options, projectDirectory: directory, port }); url = service.url; }
    catch (error) { released = (error as { resourcesReleased?: boolean })?.resourcesReleased === true; throw error; }
  };
  const failures: unknown[] = [];
  try {
    await startAt(0);
    await use({
      directory,
      get url() { return url; },
      async seed(texts) {
        const before = new Set((await queryStatus(url)).snapshot.segments.map(segment => segment.id));
        await modifyBatch(url, { changes: texts.map(text => ({ kind: 'add', text })) });
        return (await queryStatus(url)).snapshot.segments.filter(segment => !before.has(segment.id)).map(segment => segment.id);
      },
      modify: batch => modifyBatch(url, batch),
      status: () => queryStatus(url),
      async restart(whileStopped) {
        if (!service) throw new Error('服务未恢复，不能自动重试');
        const port = Number(new URL(url).port);
        await service.close();
        service = undefined;
        released = true;
        const errors: unknown[] = [];
        try { await whileStopped?.(); } catch (error) { errors.push(error); }
        try { await startAt(port); }
        catch (error) {
          if (!errors.length) throw error;
          throw new AggregateError([...errors, error], `离线回调失败：${String(errors[0])}；恢复启动失败：${String(error)}`);
        }
        if (errors.length) throw errors[0];
      },
    });
  } catch (error) { failures.push(error); }
  // 首次启动、恢复启动和测试体失败都进入这里；启动拒绝本身不是释放证明。
  if (service) {
    try { await service.close(); released = true; } catch (error) { released = false; failures.push(error); }
  }
  if (released) {
    try { await rm(directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
  } else failures.push(new Error(`项目资源未确认释放；保留目录 ${directory}`));
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, failures.map(String).join('；'));
}
export const test = base.extend<{ project: Project; speechRuntime: SpeechRuntime | undefined }, { panelDirectory: string; panelBuildIdentity: BuildIdentity | undefined; projectServer: typeof startService }>({
  projectServer: [async ({}, use) => { await use(startService); }, { scope: 'worker' }],
  panelBuildIdentity: [undefined, { scope: 'worker', option: true }],
  panelDirectory: [async ({ panelBuildIdentity }, use) => {
    if (!panelBuildIdentity) {
      const directory = process.env.CLAPGRID_TEST_PANEL_DIRECTORY;
      if (!directory) throw new Error('缺少 Playwright 全局准备的面板构建');
      await use(directory);
      return;
    }
    // 受控刷新测试保留独立构建，不能改写整轮共享的普通面板。
    const directory = await mkdtemp(join(tmpdir(), 'clapgrid-panel-'));
    try {
      await build({ configFile: resolve('vite.config.ts'), logLevel: 'error', define: panelBuildIdentity ? { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(panelBuildIdentity) } : undefined, build: { outDir: directory, emptyOutDir: true } });
      await use(directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, { scope: 'worker' }],
  speechRuntime: [undefined, { option: true }],
  project: async ({ panelDirectory, speechRuntime, projectServer }, use) => {
    await useProject({ panelDirectory, speechRuntime }, projectServer, use);
  },
});
export { expect };
