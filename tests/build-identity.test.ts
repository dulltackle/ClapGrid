import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';

const repository = resolve('.');
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-build-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['src', 'plugins', 'package.json', 'package-lock.json']) {
    // 依赖只共享读取；源文件和构建输出使用隔离目录。
    cpSync(join(repository, name), join(root, name), { recursive: true });
  }
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'));
  mkdirSync(join(root, 'dist/panel'), { recursive: true });
  writeFileSync(join(root, 'dist/panel/index.html'), '<!doctype html><html>原始面板</html>');
  return root;
}
function build(root: string) {
  execFileSync(process.execPath, [join(repository, 'scripts/build-plugin.mjs')], { cwd: root, stdio: 'pipe', env: { ...process.env, NODE_PATH: join(repository, 'node_modules') } });
  return JSON.parse(readFileSync(join(root, 'dist/plugin/clapgrid/build-identity.json'), 'utf8'));
}

test('插件构建携带源码状态，清单版本与身份一致，内容改变产生新版本和指纹', async t => {
  const root = fixture(t);
  writeFileSync(join(root, '.gitignore'), 'dist/\nnode_modules\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.gitignore', 'src', 'plugins', 'package.json', 'package-lock.json'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=测试', '-c', 'user.email=test@example.invalid', 'commit', '-qm', '初始源码'], { cwd: root });
  const first = build(root);
  assert.equal(first.state, 'known');
  assert.match(first.source.commit, /^[a-f0-9]{40}$/);
  assert.equal(first.source.state, 'clean');
  assert.match(first.contentFingerprint, /^sha256:[a-f0-9]{64}$/);
  const plugin = join(root, 'dist/plugin/clapgrid');
  const { readPluginIdentity } = await import(resolve('scripts/plugin-identity.mjs'));
  assert.deepEqual(await readPluginIdentity(plugin), first);
  assert.equal(JSON.parse(readFileSync(join(plugin, '.codex-plugin/plugin.json'), 'utf8')).version, first.version);
  assert.ok(readFileSync(join(plugin, 'dist/panel/index.html'), 'utf8').startsWith('<!doctype html>'), '保留标准模式');
  assert.ok(readFileSync(join(plugin, 'dist/panel/index.html'), 'utf8').includes(first.contentFingerprint), '面板携带自身构建指纹');
  writeFileSync(join(root, 'src/build-identity.ts'), readFileSync(join(root, 'src/build-identity.ts'), 'utf8') + '\n// 未提交源码修改\n');
  writeFileSync(join(root, 'dist/panel/index.html'), '<html>新面板</html>');
  const second = build(root);
  assert.equal(second.source.state, 'dirty');
  assert.equal(second.source.commit, first.source.commit);
  assert.notEqual(second.version, first.version);
  assert.notEqual(second.contentFingerprint, first.contentFingerprint);
  assert.deepEqual(await readPluginIdentity(plugin), second);
  const entry = join(plugin, 'dist/mcp/main.js');
  writeFileSync(entry, readFileSync(entry, 'utf8') + '\n// 磁盘包未经构建地改变\n');
  assert.deepEqual(await readPluginIdentity(plugin), { schemaVersion: 1, state: 'unknown' });
  build(root);
  rmSync(join(plugin, 'build-identity.json'));
  assert.deepEqual(await readPluginIdentity(plugin), { schemaVersion: 1, state: 'unknown' });
});

test('真实 MCP 和 HTTP 报告加载身份，覆盖磁盘更新、缺失身份与诊断副作用', async t => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { spawn } = await import('node:child_process');
  const { existsSync, readdirSync, statSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const root = fixture(t);
  const first = build(root);
  assert.equal(first.source.state, 'unknown');
  const plugin = join(root, 'dist/plugin/clapgrid');
  async function mcp() {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(plugin, 'dist/mcp/main.js')], cwd: root, stderr: 'pipe' });
    const client = new Client({ name: '身份测试', version: '1' });
    await client.connect(transport);
    t.after(() => client.close());
    return client;
  }
  const client = await mcp();
  const diagnose = async (target = client) => (await target.callTool({ name: 'clapgrid_host_context', arguments: {}, _meta: { token: '隐藏令牌', '隐藏键名': '供应商密钥' } })).structuredContent as Record<string, unknown>;
  const before = await diagnose();
  assert.deepEqual(before.buildIdentity, first);
  assert.equal(JSON.stringify(before).includes('隐藏'), false);
  assert.equal(existsSync(join(root, 'clapgrid')), false);
  const service = spawn(process.execPath, [join(plugin, 'dist/service/main.js'), '--workspace', root, '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stderr.resume();
  t.after(async () => { if (service.exitCode === null) { service.kill('SIGTERM'); await once(service, 'exit'); } });
  const url = await new Promise<string>((resolveUrl, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 15000);
    service.once('exit', code => { clearTimeout(timer); reject(new Error(`服务退出 ${code}`)); });
    service.stdout.on('data', chunk => { output += String(chunk); if (output.includes('\n')) { clearTimeout(timer); resolveUrl(JSON.parse(output.split('\n')[0]!).url); } });
  });
  function projectSnapshot() {
    const dir = join(root, 'clapgrid');
    return readdirSync(dir, { recursive: true }).sort().map(name => {
      const path = join(dir, String(name)); const stat = statSync(path);
      return [name, stat.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'directory'];
    });
  }
  const snapshot = projectSnapshot();
  const http = async () => (await (await fetch(`${url}/api/identity`, { headers: { authorization: 'Bearer secret-token', 'x-provider-key': 'secret-key' } })).json());
  const running = await http();
  // 汇总读取真实公开接口的证据；该受控进程不冒充用户宿主。
  const evidencePath = join(root, 'host-evidence.json');
  const installed = join(root, 'installed');
  cpSync(plugin, installed, { recursive: true });
  async function summary() {
    writeFileSync(evidencePath, JSON.stringify({ source: 'controlled-test', observedAt: new Date().toISOString(),
      status: 'reachable', response: await diagnose() }));
    return JSON.parse(execFileSync(process.execPath, [join(repository, 'scripts/diagnose-identity.mjs'),
      '--build', plugin, '--installed', installed, '--mcp-evidence', evidencePath,
      '--workspace', root, '--service-url', url], { encoding: 'utf8' }));
  }
  const matching = await summary();
  assert.deepEqual([matching.build.status, matching.installed.status, matching.mcp.status, matching.service.status],
    ['match', 'match', 'match', 'match']);
  assert.equal(matching.mcp.source, 'controlled-test');
  assert.equal(matching.mcp.live, false);
  // 以下只验证证据格式的接受/拒绝契约；标签为测试输入，不宣称宿主实测。
  const panelEvidence = join(root, 'panel-evidence.json');
  const gate = () => {
    try { return { code: 0, report: JSON.parse(execFileSync(process.execPath, [join(repository, 'scripts/diagnose-identity.mjs'), '--require-current',
      '--build', plugin, '--installed', installed, '--mcp-evidence', evidencePath, '--panel-evidence', panelEvidence,
      '--workspace', root, '--service-url', url], { encoding: 'utf8' })) }; }
    catch (error: any) { return { code: error.status, report: JSON.parse(error.stdout) }; }
  };
  const observedAt = new Date().toISOString();
  const panelInput = { source: 'actual-browser', observedAt, status: 'reachable', response: { buildIdentity: first, instanceId: running.instanceId, workspace: root } };
  writeFileSync(panelEvidence, JSON.stringify(panelInput));
  assert.equal(gate().code, 2, 'controlled-test 宿主证据不能通过交付门槛');
  writeFileSync(evidencePath, JSON.stringify({ source: 'actual-host', observedAt, status: 'reachable',
    response: { buildIdentity: first, workspace: root }, serviceStatus: { buildIdentity: first, instanceId: running.instanceId } }));
  assert.equal(gate().code, 0, '完整且同实例的证据可以通过格式核对');
  writeFileSync(panelEvidence, JSON.stringify({ ...panelInput, response: { ...panelInput.response, instanceId: '其他实例' } }));
  assert.equal(gate().code, 2, '不同服务实例拒绝通过');

  assert.deepEqual(projectSnapshot(), snapshot);

  assert.deepEqual(running.buildIdentity, first);
  assert.equal(JSON.stringify(running).includes('secret-'), false);
  writeFileSync(join(root, 'dist/panel/index.html'), '<html>磁盘更新</html>');
  const second = build(root);
  assert.notEqual(first.contentFingerprint, second.contentFingerprint);
  assert.notEqual(first.version, second.version);
  const oldInstall = await summary();
  assert.equal(oldInstall.installed.status, 'mismatch');
  cpSync(plugin, installed, { recursive: true });
  const outdated = await summary();
  assert.deepEqual([outdated.installed.status, outdated.mcp.status, outdated.service.status], ['match', 'mismatch', 'mismatch']);
  assert.equal(outdated.mcp.identity.contentFingerprint, first.contentFingerprint);
  assert.equal(outdated.mcp.referenceFingerprint, second.contentFingerprint);
  assert.ok(outdated.nextSteps.some((step: string) => step.includes('重载')));
  assert.equal(service.exitCode, null);

  assert.deepEqual((await diagnose()).buildIdentity, first);
  assert.deepEqual((await http()).buildIdentity, first);
  const next = await mcp();
  assert.deepEqual((await diagnose(next)).buildIdentity, second);
  rmSync(join(plugin, 'build-identity.json'));
  const missing = await summary();
  assert.deepEqual([missing.build.status, missing.installed.status, missing.mcp.status, missing.service.status],
    ['unknown', 'unknown', 'unknown', 'unknown']);
  assert.deepEqual((await diagnose()).buildIdentity, first);
  assert.deepEqual((await http()).buildIdentity, first);
  const entry = join(plugin, 'dist/mcp/main.js');
  writeFileSync(entry, readFileSync(entry, 'utf8').split('\n').slice(1).join('\n'));
  assert.deepEqual((await diagnose(await mcp())).buildIdentity, { schemaVersion: 1, state: 'unknown' });
  assert.deepEqual(projectSnapshot(), snapshot);
  assert.equal((await http()).instanceId, running.instanceId);
});
