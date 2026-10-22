import { test } from './helpers/resource-test.js';
import { vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('进程追踪命令缺少 strace 时失败并保留诊断证据', async ({ command, createDirectory, skip }) => {
  if (process.platform !== 'linux') skip('进程追踪仅支持 Linux');
  const directory = createDirectory(join(tmpdir(), 'clapgrid-trace-command-'));
  const run = (await command(process.execPath, [resolve('scripts/verify-speech-export-processes.mjs'), directory], {
    encoding: 'utf8', env: { ...process.env, PATH: directory },
  }));
  assert.equal(run.status, 1);
  const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /strace/);
  assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), /失败/);
  assert.match(readFileSync(join(directory, 'tests.log'), 'utf8'), /strace/);
  assert.equal(readFileSync(join(directory, 'exec.trace'), 'utf8'), '');
});
