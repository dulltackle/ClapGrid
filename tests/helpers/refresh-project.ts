import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test as base } from './project.js';
import type { BuildIdentity } from '../../src/build-identity.js';
import type { startService } from '../../src/service/server.js';

export const loadedIdentity: BuildIdentity = { schemaVersion: 2, state: 'known', version: '受控刷新测试', source: { commit: null, state: 'unknown' }, contentFingerprint: `sha256:${'a'.repeat(64)}`, runtimeFingerprint: `sha256:${'b'.repeat(64)}`, panelFingerprint: `sha256:${'a'.repeat(64)}`, protocolVersion: 1 };

/** 只为代次提示构建带明确身份的真实服务；不模拟编辑流，也不代表实际宿主交付。 */
export const test = base.extend({
  panelBuildIdentity: [loadedIdentity, { scope: 'worker' }],
  projectServer: [async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'clapgrid-refresh-server-'));
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
      await build({ entryPoints: ['src/service/server.ts', 'src/business/media-worker.ts'], outbase: 'src', outdir: directory, bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);" }, define: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify({ ...loadedIdentity, panelFingerprint: `sha256:${'c'.repeat(64)}` }) }, logLevel: 'error' });
      const server = await import(pathToFileURL(join(directory, 'service/server.js')).href) as { startService: typeof startService };
      await use(server.startService);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, { scope: 'worker' }],
});
export { expect } from '@playwright/test';
