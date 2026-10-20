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
export const test = base.extend<{ project: Project; speechRuntime: SpeechRuntime | undefined }, { panelDirectory: string; panelBuildIdentity: BuildIdentity | undefined }>({
  panelBuildIdentity: [undefined, { scope: 'worker', option: true }],
  panelDirectory: [async ({ panelBuildIdentity }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'clapgrid-panel-'));
    try {
      await build({ configFile: resolve('vite.config.ts'), logLevel: 'error', define: panelBuildIdentity ? { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(panelBuildIdentity) } : undefined, build: { outDir: directory, emptyOutDir: true } });
      await use(directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, { scope: 'worker' }],
  speechRuntime: [undefined, { option: true }],
  project: async ({ panelDirectory, speechRuntime }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'clapgrid-browser-'));
    const options = { projectDirectory: directory, panelDirectory, port: 0, speechRuntime };
    let service = await startService(options);
    try {
      await use({
        directory,
        get url() { return service.url; },
        async seed(texts) {
          const before = new Set((await queryStatus(service.url)).snapshot.segments.map(segment => segment.id));
          await modifyBatch(service.url, { changes: texts.map(text => ({ kind: 'add', text })) });
          return (await queryStatus(service.url)).snapshot.segments.filter(segment => !before.has(segment.id)).map(segment => segment.id);
        },
        modify: batch => modifyBatch(service.url, batch),
        status: () => queryStatus(service.url),
        async restart(whileStopped) {
          const port = Number(new URL(service.url).port);
          await service.close();
          // 具体断线场景先观察真实离线边界，再恢复同一项目；断言失败也正常重启以便收尾。
          try { await whileStopped?.(); }
          finally { service = await startService({ ...options, port }); }
        },
      });
    } finally {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});
export { expect };
