import { test as baseTest, type ResourceFixtures } from './helpers/resource-test.js';
import type { TestContext } from 'vitest';
import { vi } from 'vitest';
import assert from 'node:assert/strict';
import { rmSync, symlinkSync, writeFileSync, existsSync, mkdirSync, readlinkSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Resources = Pick<ResourceFixtures, 'command' | 'createDirectory'> & Pick<TestContext, 'skip' | 'annotate'>;

const script = resolve('plugins/clapgrid/scripts/runtime-linux.sh');
const supported = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch) && !!(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
const test = baseTest.skipIf(process.platform !== 'linux');
const installTest = baseTest.skipIf(!supported);
async function ready(t: Pick<Resources, 'command'>, root: string) {
  return (await t.command('/bin/bash', [script, 'check'], {
    env: { ...process.env, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  })).status === 0;
}
test('组件缺失时检查返回可重试的明确错误，不尝试启动服务', async ({ command, createDirectory, skip }) => {
  if (process.platform !== 'linux') skip('此验证需要 Linux 运行环境');
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  const result = (await command('/bin/bash', [script, 'check'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(result.status, 10);
  assert.match(result.stderr, /组件.*缺失|组件.*不兼容/);
  assert.match(result.stderr, /install/);
});

test('安装基础工具缺失时说明原因与重试方式，恢复组件后重试成功', async ({ command, createDirectory, skip, annotate }) => {
  const t = { command };
  if (!supported) skip('安装组件验证需要 glibc x86_64/aarch64 Linux');
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  symlinkSync('/usr/bin/uname', join(root, 'uname'));
  symlinkSync('/usr/bin/getconf', join(root, 'getconf'));
  const result = (await command('/bin/bash', [script, 'install'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(result.status, 13);
  assert.match(result.stderr, /curl/);
  assert.match(result.stderr, /重新执行 install/);
  if (!(await ready(t, root))) { await annotate('宿主组件未就绪，恢复后的真实安装仅在隔离容器验证', 'notice'); return; }
  const retry = (await command('/bin/bash', [script, 'install'], {
    env: { ...process.env, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(retry.status, 0, retry.stderr);
});

test('已有可用组件时重复安装直接复用，无需管理员权限或网络', async ({ command, createDirectory, skip }) => {
  const t = { command };
  if (process.platform !== 'linux') skip('此验证需要 Linux 运行环境');
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  // 可能跳过时先完成资源回收，避免原生 pending 状态覆盖清理异常。
  let available: boolean;
  try { available = (await ready(t, root)); } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  if (!available) { rmSync(root, { recursive: true, force: true }); skip('复用验证需要已有组件；不在测试中安装宿主组件'); return; }

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = (await command('/bin/bash', [script, 'install'], {
      env: { ...process.env, CLAPGRID_RUNTIME_HOME: root, HTTPS_PROXY: 'http://127.0.0.1:1' }, encoding: 'utf8',
    }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /已就绪.*跳过安装/);
  }
});

test('有媒体编码器但缺少字体工具时不能宣称组件就绪', async ({ command, createDirectory, skip }) => {
  const t = { command };
  if (process.platform !== 'linux') skip('此验证需要 Linux 运行环境');
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  // 可能跳过时先完成资源回收，避免原生 pending 状态覆盖清理异常。
  let available: boolean;
  try { available = (await ready(t, root)); } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  if (!available) { rmSync(root, { recursive: true, force: true }); skip('需要真实媒体组件'); return; }

  for (const tool of ['node', 'ffmpeg', 'ffprobe']) {
    const path = (await command('/bin/bash', ['-c', 'command -v "$1"', 'bash', tool], { encoding: 'utf8' })).stdout.trim();
    symlinkSync(path, join(root, tool));
  }
  const result = (await command('/bin/bash', [script, 'check'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: root }, encoding: 'utf8',
  }));
  assert.equal(result.status, 10);
});

// 仅替换平台与外部工具边界，通过正式命令接口观察安装行为。
function platformTools(root: string, machine = 'x86_64', libc = 'glibc 2.42') {
  for (const [name, output] of [['uname', machine], ['getconf', libc]] as const) {
    writeFileSync(join(root, name), `#!/bin/bash\necho '${output}'\n`, { mode: 0o755 });
  }
}

test('缺少 fc-list 时返回 13 并指出重试方式', async ({ command, createDirectory }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  platformTools(root);
  for (const name of ['curl', 'tar', 'xz', 'sha256sum', 'mktemp', 'mkdir', 'mv', 'rm', 'flock']) {
    symlinkSync(`/usr/bin/${name}`, join(root, name));
  }
  const result = await command('/bin/bash', [script, 'install'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: join(root, 'runtime') }, encoding: 'utf8',
  });
  assert.equal(result.status, 13, result.stderr);
  assert.match(result.stderr, /fc-list/);
  assert.match(result.stderr, /重新执行 install/);
});

for (const [machine, libc] of [['riscv64', 'glibc 2.42'], ['x86_64', 'musl']] as const) {
  test(`不支持的平台 ${machine}/${libc} 明确返回 11 且不创建组件`, async ({ command, createDirectory }) => {
    const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
    platformTools(root, machine, libc);
    const runtime = join(root, 'runtime');
    const result = await command('/bin/bash', [script, 'install'], {
      env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: runtime }, encoding: 'utf8',
    });
    assert.equal(result.status, 11, result.stderr);
    assert.match(result.stderr, /自行提供兼容组件后执行 check/);
    assert.equal(existsSync(runtime), false);
  });
}

const baseTools = ['uname', 'getconf', 'curl', 'tar', 'xz', 'sha256sum', 'mktemp', 'mkdir', 'mv', 'rm', 'flock', 'fc-list', 'cat'];
function installTools(root: string) {
  for (const tool of baseTools) symlinkSync(`/usr/bin/${tool}`, join(root, tool));
}

installTest('下载断网返回 13，保留已可用的用户 Node 并可重复重试', async ({ command, createDirectory }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  installTools(root);
  const runtime = join(root, 'runtime');
  mkdirSync(join(runtime, 'node', 'bin'), { recursive: true });
  symlinkSync(process.execPath, join(runtime, 'node', 'bin', 'node'));
  for (let i = 0; i < 2; i++) {
    const result = await command('/bin/bash', [script, 'install'], {
      env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: runtime, HTTPS_PROXY: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1', NO_PROXY: '', no_proxy: '' }, encoding: 'utf8',
    });
    assert.equal(result.status, 13, result.stderr);
    assert.match(result.stderr, /ffmpeg.*下载失败/);
    assert.match(result.stderr, /重新执行 install/);
    assert.equal(readlinkSync(join(runtime, 'node', 'bin', 'node')), process.execPath);
    assert.deepEqual(readdirSync(runtime).sort(), ['install.lock', 'node']);
  }
});

installTest('下载摘要不匹配时拒绝发布，保留原有损坏组件并清理临时目录', async ({ command, createDirectory }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  installTools(root);
  unlinkSync(join(root, 'curl'));
  writeFileSync(join(root, 'curl'), '#!/bin/bash\nwhile (( $# )); do if [[ $1 == -o ]]; then printf corrupt > "$2"; exit; fi; shift; done\n', { mode: 0o755 });
  const runtime = join(root, 'runtime');
  mkdirSync(join(runtime, 'node'), { recursive: true });
  writeFileSync(join(runtime, 'node', 'incomplete'), '旧组件');
  const result = await command('/bin/bash', [script, 'install'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: runtime }, encoding: 'utf8',
  });
  assert.equal(result.status, 13, result.stderr);
  assert.match(result.stderr, /SHA-256.*校验失败/);
  assert.equal(readFileSync(join(runtime, 'node', 'incomplete'), 'utf8'), '旧组件');
  assert.deepEqual(readdirSync(runtime).sort(), ['install.lock', 'node']);
});

installTest('另一个 install 持有锁时明确提示且不触碰组件', async ({ command, createDirectory }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  installTools(root);
  const runtime = join(root, 'runtime');
  mkdirSync(runtime);
  // 父进程持有真实 flock，子入口尝试同一把锁，无需基于时间的等待。
  const result = await command('/usr/bin/flock', [join(runtime, 'install.lock'), '/bin/bash', script, 'install'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: runtime }, encoding: 'utf8',
  });
  assert.equal(result.status, 13, result.stderr);
  assert.match(result.stderr, /另一个组件安装正在进行/);
  assert.deepEqual(readdirSync(runtime), ['install.lock']);
});

test('check 使用用户目录的媒体组件，系统已有的可用组件仍优先', async ({ command, createDirectory, skip }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-components-'));
  if (!(await ready({ command }, root))) skip('需要真实媒体组件；不在测试中安装宿主组件');
  installTools(root);
  symlinkSync(process.execPath, join(root, 'node'));
  const runtime = join(root, 'runtime');
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const path = (await command('/bin/bash', ['-c', 'command -v "$1"', 'bash', tool], { encoding: 'utf8' })).stdout.trim();
    mkdirSync(join(runtime, 'media', tool), { recursive: true });
    symlinkSync(path, join(runtime, 'media', tool, tool));
  }
  const local = await command('/bin/bash', [script, 'check'], {
    env: { ...process.env, PATH: root, CLAPGRID_RUNTIME_HOME: runtime }, encoding: 'utf8',
  });
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /ffmpeg version/);
  assert.match(local.stdout, /ffprobe version/);
  // 用户目录损坏时，可用的系统组件仍可直接复用。
  for (const tool of ['ffmpeg', 'ffprobe']) {
    unlinkSync(join(runtime, 'media', tool, tool));
    writeFileSync(join(runtime, 'media', tool, tool), '#!/bin/bash\nexit 99\n', { mode: 0o755 });
  }
  const system = await command('/bin/bash', [script, 'install'], {
    env: { ...process.env, CLAPGRID_RUNTIME_HOME: runtime, HTTPS_PROXY: 'http://127.0.0.1:1' }, encoding: 'utf8',
  });
  assert.equal(system.status, 0, system.stderr);
  assert.match(system.stdout, /跳过安装/);
});
