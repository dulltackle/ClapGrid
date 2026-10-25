import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import type { BuildIdentity } from '../../src/build-identity.js';
import type { FullConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { panelFilesFingerprint, panelIdentityBanner } from '../../src/plugin-package.mjs';

/** 普通面板由本轮拥有；worker 只读使用，全部退出后由 Playwright 清理。 */
export default async function setupPanel(config: FullConfig) {
  const directory = await mkdtemp(join(tmpdir(), 'clapgrid-panel-run-'));
  try {
    await build({ configFile: resolve('vite.config.ts'), logLevel: 'error', build: { outDir: directory, emptyOutDir: true } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  if (config.metadata.acceptance) {
    try {
      const files = new Map<string, Buffer>();
      async function collect(relative = '') {
        for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
          const path = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await collect(path);
          else files.set('/' + path, await readFile(join(directory, path)));
        }
      }
      await collect();
      const identity: BuildIdentity = { schemaVersion: 1, state: 'known', version: 'candidate-panel',
        source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          state: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ? 'dirty' : 'clean' },
        contentFingerprint: panelFilesFingerprint(files) };
      const html = files.get('/index.html')!.toString();
      const doctype = html.match(/^<!doctype[^>]*>/i)?.[0] ?? '';
      await writeFile(join(directory, 'index.html'), doctype + panelIdentityBanner(identity) + html.slice(doctype.length));
      process.env.CLAPGRID_ACCEPTANCE_PANEL_IDENTITY = JSON.stringify(identity);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  const previousDirectory = process.env.CLAPGRID_TEST_PANEL_DIRECTORY;
  process.env.CLAPGRID_TEST_PANEL_DIRECTORY = directory;
  return async () => {
    if (previousDirectory === undefined) delete process.env.CLAPGRID_TEST_PANEL_DIRECTORY;
    else process.env.CLAPGRID_TEST_PANEL_DIRECTORY = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  };
}
