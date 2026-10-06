import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('进程追踪命令缺少 strace 时失败并保留诊断证据', { skip: process.platform !== 'linux' && '进程追踪仅支持 Linux' }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-trace-command-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [resolve('scripts/verify-speech-export-processes.mjs'), directory], {
    encoding: 'utf8', env: { ...process.env, PATH: directory },
  });
  assert.equal(run.status, 1);
  const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /strace/);
  assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), /失败/);
  assert.match(readFileSync(join(directory, 'tests.tap'), 'utf8'), /strace/);
  assert.equal(readFileSync(join(directory, 'exec.trace'), 'utf8'), '');
});
