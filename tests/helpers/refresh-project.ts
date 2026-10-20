import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test as base, type Project } from './project.js';
import { modifyBatch, queryStatus } from '../../src/shared/client.js';
import type { BuildIdentity } from '../../src/build-identity.js';
import type { startService } from '../../src/service/server.js';

export const loadedIdentity: BuildIdentity = { schemaVersion: 2, state: 'known', version: '受控刷新测试', source: { commit: null, state: 'unknown' }, contentFingerprint: `sha256:${'a'.repeat(64)}`, runtimeFingerprint: `sha256:${'b'.repeat(64)}`, panelFingerprint: `sha256:${'a'.repeat(64)}`, protocolVersion: 1 };

/** 只为代次提示构建带明确身份的真实服务；不模拟编辑流，也不代表实际宿主交付。 */
export const test = base.extend<{}, { refreshServer: typeof startService }>({
  panelBuildIdentity: [loadedIdentity, { scope: 'worker' }],
  refreshServer: [async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'clapgrid-refresh-server-'));
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
      await build({ entryPoints: ['src/service/server.ts', 'src/business/media-worker.ts'], outbase: 'src', outdir: directory, bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);" }, define: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify({ ...loadedIdentity, panelFingerprint: `sha256:${'c'.repeat(64)}` }) }, logLevel: 'error' });
      const server = await import(pathToFileURL(join(directory, 'service/server.js')).href) as { startService: typeof startService };
      await use(server.startService);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, { scope: 'worker' }],
  project: async ({ panelDirectory, refreshServer }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'clapgrid-refresh-project-'));
    const options = { projectDirectory: directory, panelDirectory, port: 0 };
    let service = await refreshServer(options);
    try {
      const project: Project = {
        directory,
        get url() { return service.url; },
        async seed(texts) { const before = new Set((await queryStatus(service.url)).snapshot.segments.map(s => s.id)); await modifyBatch(service.url, { changes: texts.map(text => ({ kind: 'add', text })) }); return (await queryStatus(service.url)).snapshot.segments.filter(s => !before.has(s.id)).map(s => s.id); },
        modify: batch => modifyBatch(service.url, batch), status: () => queryStatus(service.url),
        async restart() { const port = Number(new URL(service.url).port); await service.close(); service = await refreshServer({ ...options, port }); },
      };
      await use(project);
    } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
  },
});
export { expect } from '@playwright/test';
