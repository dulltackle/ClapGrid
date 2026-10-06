import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('plugins/clapgrid/scripts/runtime-linux.sh');
const ubuntu = process.platform === 'linux' && /^ID=ubuntu$/m.test(readFileSync('/etc/os-release', 'utf8')) && /^VERSION_ID="24\.04"$/m.test(readFileSync('/etc/os-release', 'utf8'));
function ready(root: string) {
  return spawnSync('/bin/bash', [script, 'check'], {
    env: { ...process.env, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }).status === 0;
}
test('组件缺失时检查返回可重试的明确错误，不尝试启动服务', { skip: process.platform === 'linux' ? false : '此验证需要 Linux 运行环境' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync('/bin/bash', [script, 'check'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  });
  assert.equal(result.status, 10);
  assert.match(result.stderr, /组件.*缺失|组件.*不兼容/);
  assert.match(result.stderr, /install/);
});

test('安装基础工具缺失时说明原因与重试方式，恢复组件后重试成功', { skip: ubuntu ? false : '安装组件验证需要 Ubuntu 24.04 运行环境' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  symlinkSync('/usr/bin/uname', join(root, 'uname'));
  const result = spawnSync('/bin/bash', [script, 'install'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  });
  assert.equal(result.status, 13);
  assert.match(result.stderr, /curl/);
  assert.match(result.stderr, /重新执行 install/);
  if (!ready(root)) { t.diagnostic('宿主组件未就绪，恢复后的真实安装仅在隔离容器验证'); return; }
  const retry = spawnSync('/bin/bash', [script, 'install'], {
    env: { ...process.env, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  });
  assert.equal(retry.status, 0, retry.stderr);
});

test('已有可用组件时重复安装直接复用，无需管理员权限或网络', { skip: process.platform === 'linux' ? false : '此验证需要 Linux 运行环境' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (!ready(root)) { t.skip('复用验证需要已有组件；不在测试中安装宿主组件'); return; }
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync('/bin/bash', [script, 'install'], {
      env: { ...process.env, CLAPGRID_RUNTIME_HOME: root, HTTPS_PROXY: 'http://127.0.0.1:1' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /已就绪.*跳过安装/);
  }
});

test('有媒体编码器但缺少字体工具时不能宣称组件就绪', { skip: process.platform === 'linux' ? false : '此验证需要 Linux 运行环境' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-components-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (!ready(root)) { t.skip('需要真实媒体组件'); return; }
  for (const tool of ['node', 'ffmpeg', 'ffprobe']) {
    const path = spawnSync('/bin/bash', ['-c', 'command -v "$1"', 'bash', tool], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(path, join(root, tool));
  }
  const result = spawnSync('/bin/bash', [script, 'check'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  });
  assert.equal(result.status, 10);
});
