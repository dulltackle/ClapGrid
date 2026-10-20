import { projectCleanup } from './helpers/project-cleanup.js';
import { command as runCommand } from './helpers/vitest-command.js';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';


const script = resolve('plugins/clapgrid/scripts/runtime-linux.sh');
const ubuntu = process.platform === 'linux' && /^ID=ubuntu$/m.test(readFileSync('/etc/os-release', 'utf8')) && /^VERSION_ID="24\.04"$/m.test(readFileSync('/etc/os-release', 'utf8'));
async function ready(root: string) {
  return (await runCommand('/bin/bash', [script, 'check'], {
    env: { ...process.env, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  })).status === 0;
}
test('组件缺失时检查返回可重试的明确错误，不尝试启动服务', async t => {
  if (process.platform !== 'linux') t.skip('此验证需要 Linux 运行环境');
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  projectCleanup(t).directory(root);
  const result = (await runCommand('/bin/bash', [script, 'check'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(result.status, 10);
  assert.match(result.stderr, /组件.*缺失|组件.*不兼容/);
  assert.match(result.stderr, /install/);
});

test('安装基础工具缺失时说明原因与重试方式，恢复组件后重试成功', async t => {
  if (!ubuntu) t.skip('安装组件验证需要 Ubuntu 24.04 运行环境');
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  projectCleanup(t).directory(root);
  symlinkSync('/usr/bin/uname', join(root, 'uname'));
  const result = (await runCommand('/bin/bash', [script, 'install'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(result.status, 13);
  assert.match(result.stderr, /curl/);
  assert.match(result.stderr, /重新执行 install/);
  if (!(await ready(root))) { await t.annotate('宿主组件未就绪，恢复后的真实安装仅在隔离容器验证', 'notice'); return; }
  const retry = (await runCommand('/bin/bash', [script, 'install'], {
    env: { ...process.env, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(retry.status, 0, retry.stderr);
});

test('已有可用组件时重复安装直接复用，无需管理员权限或网络', async t => {
  if (process.platform !== 'linux') t.skip('此验证需要 Linux 运行环境');
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  // 可能跳过时先完成资源回收，避免原生 pending 状态覆盖清理异常。
  let available: boolean;
  try { available = (await ready(root)); } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  if (!available) { rmSync(root, { recursive: true, force: true }); t.skip('复用验证需要已有组件；不在测试中安装宿主组件'); return; }
  projectCleanup(t).directory(root);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = (await runCommand('/bin/bash', [script, 'install'], {
      env: { ...process.env, CLAPGRID_RUNTIME_HOME: root, HTTPS_PROXY: 'http://127.0.0.1:1' }, encoding: 'utf8',
    }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /已就绪.*跳过安装/);
  }
});

test('有媒体编码器但缺少字体工具时不能宣称组件就绪', async t => {
  if (process.platform !== 'linux') t.skip('此验证需要 Linux 运行环境');
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  // 可能跳过时先完成资源回收，避免原生 pending 状态覆盖清理异常。
  let available: boolean;
  try { available = (await ready(root)); } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  if (!available) { rmSync(root, { recursive: true, force: true }); t.skip('需要真实媒体组件'); return; }
  projectCleanup(t).directory(root);
  for (const tool of ['node', 'ffmpeg', 'ffprobe']) {
    const path = (await runCommand('/bin/bash', ['-c', 'command -v "$1"', 'bash', tool], { encoding: 'utf8' })).stdout.trim();
    symlinkSync(path, join(root, tool));
  }
  const result = (await runCommand('/bin/bash', [script, 'check'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(result.status, 10);
});
