import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const chrome = process.env.CHROME_BIN ?? ['google-chrome', 'chromium', 'chromium-browser'].find(command => spawnSync(command, ['--version']).status === 0);

test('导出与取消被拒后轮询仍保留提示，连接恢复只清除连接错误，再次操作才清除旧提示', {
  skip: chrome ? false : '需要 Chrome/Chromium，可通过 CHROME_BIN 指定', timeout: 30000,
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-panel-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = `
    export const state = { connectionFailure: false, submitFailure: true, cancelFailure: true, exports: { locked: false, tasks: [] } };
    export async function queryExports() { if (state.connectionFailure) throw Error('读取导出任务失败'); return state.exports; }
    export async function submitExport() { if (state.submitFailure) throw Error('Codex 正在修改'); return { id: 'test' }; }
    export async function cancelExport() { if (state.cancelFailure) throw Error('取消导出失败'); return { id: 'test' }; }
    export async function queryStatus() { return {}; }
  `;
  await build({
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx', contents: String.raw`
      import { act } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ExportTasksPanel } from './src/panel/export-tasks.tsx';
      import { state } from 'export-fixture';
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      let refresh;
      window.setInterval = callback => { refresh = callback; return 1; };
      const result = document.getElementById('result');
      const root = createRoot(document.getElementById('root'));
      const alerts = () => [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent).join('\n');
      const check = (condition, message) => { if (!condition) throw Error(message + '；实际提示：' + alerts()); };
      const click = async text => { await act(async () => {
        const button = [...document.querySelectorAll('button')].find(node => node.textContent === text);
        if (!button || button.disabled) throw Error('按钮不可用：' + text);
        button.click();
      }); };
      (async () => {
        try {
          await act(async () => { root.render(<ExportTasksPanel onStatus={() => {}} />); });
          await click('导出全片');
          check(alerts().includes('Codex 正在修改'), '应显示编辑期间拒绝导出的原因');
          await act(async () => { refresh(); });
          check(alerts().includes('Codex 正在修改'), '正常轮询不能清除提交拒绝提示');
          state.connectionFailure = true;
          await act(async () => { refresh(); });
          check(alerts().includes('读取导出任务失败') && alerts().includes('Codex 正在修改'), '连接错误不能覆盖提交拒绝提示');
          state.connectionFailure = false;
          await act(async () => { refresh(); });
          check(!alerts().includes('读取导出任务失败') && alerts().includes('Codex 正在修改'), '恢复连接只能清除连接错误');
          state.submitFailure = false;
          await click('导出全片');
          check(alerts() === '', '再次成功操作应清除旧拒绝提示');
          state.exports = { locked: true, tasks: [{ id: 'test', state: 'rendering', total: 1, completed: 0, createdAt: '2026-10-03T00:00:00Z', message: '正在导出', issues: [], warnings: [] }] };
          await act(async () => { refresh(); });
          await click('取消导出');
          await act(async () => { refresh(); });
          check(alerts().includes('取消导出失败'), '正常轮询不能清除取消失败提示');
          state.cancelFailure = false;
          await click('取消导出');
          check(alerts() === '', '再次成功取消应清除旧错误');
          result.textContent = '全部提示行为验证通过'; result.dataset.state = 'passed';
        } catch (error) { result.textContent = error.stack; result.dataset.state = 'failed'; }
        finally { await act(async () => { root.unmount(); }); }
      })();
    ` },
    bundle: true, jsx: 'automatic', format: 'iife', outfile: join(directory, 'test.js'), define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'export-fixture', setup(builder) {
      builder.onResolve({ filter: /^(export-fixture|\.\.\/shared\/client\.js)$/ }, () => ({ path: 'export-fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'js' }));
    } }],
  });
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><pre id="result" data-state="pending"></pre><script src="test.js"></script></html>');
  const { stdout } = await promisify(execFile)(chrome!, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${join(directory, 'profile')}`, '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(join(directory, 'index.html')).href], { timeout: 20000, maxBuffer: 1024 * 1024 });
  const result = stdout.match(/<pre id="result"[\s\S]*?<\/pre>/)?.[0] ?? stdout;
  assert.match(result, /data-state="passed"/, result);
});
