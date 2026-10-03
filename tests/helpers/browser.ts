import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { TestContext } from 'node:test';
import { build } from 'esbuild';

export const chrome = process.env.CHROME_BIN ?? ['google-chrome', 'chromium', 'chromium-browser'].find(command => spawnSync(command, ['--version']).status === 0);

/** 执行真实 React 视图；只替换 HTTP adapter，以确定顺序交付响应。 */
export async function checkBrowser(t: TestContext, script: string, fixture: string) {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-editing-panel-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'tsx', contents: script },
    bundle: true, jsx: 'automatic', format: 'iife', outfile: join(directory, 'test.js'), define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'editing-fixture', setup(builder) {
      builder.onResolve({ filter: /^(editing-fixture|\.\.\/shared\/client\.js)$/ }, () => ({ path: 'editing-fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'js' }));
    } }],
  });
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="test.css"><div id="root"></div><pre id="result" data-state="pending"></pre><script src="test.js"></script></html>');
  const { stdout } = await promisify(execFile)(chrome!, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${join(directory, 'profile')}`, '--window-size=1600,1200', '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(join(directory, 'index.html')).href], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
  const result = stdout.match(/<pre id="result"[\s\S]*?<\/pre>/)?.[0] ?? stdout;
  assert.match(result, /data-state="passed"/, result);
}
