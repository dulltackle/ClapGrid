import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

/** 普通面板由本轮拥有；worker 只读使用，全部退出后由 Playwright 清理。 */
export default async function setupPanel() {
  const directory = await mkdtemp(join(tmpdir(), 'clapgrid-panel-run-'));
  try {
    await build({ configFile: resolve('vite.config.ts'), logLevel: 'error', build: { outDir: directory, emptyOutDir: true } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const previousDirectory = process.env.CLAPGRID_TEST_PANEL_DIRECTORY;
  process.env.CLAPGRID_TEST_PANEL_DIRECTORY = directory;
  return async () => {
    if (previousDirectory === undefined) delete process.env.CLAPGRID_TEST_PANEL_DIRECTORY;
    else process.env.CLAPGRID_TEST_PANEL_DIRECTORY = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  };
}
