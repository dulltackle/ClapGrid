import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForDevToolsPort } from './helpers/browser-startup.js';

// 原 Node 默认未限时；既有每例3000ms专项时限继续优先。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

test('Chrome 端口文件先出现为空，写入完成后才视为启动成功', { timeout: 3000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-browser-startup-'));
  const path = join(root, 'DevToolsActivePort');
  writeFileSync(path, '');
  const timer = setTimeout(() => writeFileSync(path, '12345\n/devtools/browser/example\n'), 80);
  t.onTestFinished(() => { clearTimeout(timer); rmSync(root, { recursive: true, force: true }); });
  assert.equal(await waitForDevToolsPort(path, 1500), '12345');
});

test('Chrome 没有启动或端口文件持续为空时必须有限等待后失败', { timeout: 3000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-browser-startup-'));
  const path = join(root, 'DevToolsActivePort');
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const empty of [false, true]) {
    if (empty) writeFileSync(path, '');
    const start = performance.now();
    await assert.rejects(waitForDevToolsPort(path, 80), /Chrome 必须启动/);
    assert.ok(performance.now() - start >= 60, '空内容和文件未创建都应等待，不能忙循环耗尽重试');
  }
});
