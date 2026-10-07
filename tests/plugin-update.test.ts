import { startService } from '../src/service/server.js';
import { randomUUID } from 'node:crypto';
import { beginEdit } from '../src/shared/client.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const repo = resolve('.');

test('旧包和旧服务升级后保留项目，安装失败恢复旧包，缺宿主验证不冒充完成', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-update-'));
  const source = join(root, 'source'), market = join(root, 'market'), cache = join(root, 'cache'), workspace = join(root, 'workspace');
  for (const dir of [source, workspace, join(market, '.agents/plugins'), join(market, 'plugins'), cache]) mkdirSync(dir, { recursive: true });
  for (const name of ['src', 'plugins', 'package.json', 'package-lock.json']) cpSync(join(repo, name), join(source, name), { recursive: true });
  symlinkSync(join(repo, 'node_modules'), join(source, 'node_modules'));
  mkdirSync(join(source, 'dist/panel'), { recursive: true });
  const build = async (label: string) => {
    writeFileSync(join(source, 'dist/panel/index.html'), `<html>${label}</html>`);
    await exec(process.execPath, [join(repo, 'scripts/build-plugin.mjs')], { cwd: source });
    const pkg = join(root, label); cpSync(join(source, 'dist/plugin/clapgrid'), pkg, { recursive: true }); return pkg;
  };
  writeFileSync(join(source, '.gitignore'), 'node_modules\ndist/\n');
  await exec('git', ['init', '-q'], { cwd: source });
  await exec('git', ['add', '.'], { cwd: source });
  const commit = () => exec('git', ['-c', 'user.name=测试', '-c', 'user.email=test@example.invalid', 'commit', '-qam', 'test: 更新源码'], { cwd: source });
  await commit();
  const old = await build('old'), next = await build('next');
  const identity = (pkg: string) => JSON.parse(readFileSync(join(pkg, 'build-identity.json'), 'utf8'));
  const installed = (pkg: string) => join(cache, 'personal/clapgrid', identity(pkg).version);
  const marketSource = join(market, 'plugins/clapgrid'); cpSync(old, marketSource, { recursive: true }); cpSync(old, installed(old), { recursive: true });
  writeFileSync(join(market, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'personal', plugins: [{ name: 'clapgrid', source: { source: 'local', path: './plugins/clapgrid' } }] }));
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nrequire('node:readline').createInterface({input:process.stdin}).on('line',l=>{const r=JSON.parse(l);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:{id:'00000000-0000-4000-8000-000000000071',cwd:${JSON.stringify(workspace)}}}}));});`, { mode: 0o700 });
  // 只替换外部安装器进程；包、HTTP 服务、SQLite 项目和打开入口均为真实实现。
  const installer = join(root, 'installer.cjs');
  writeFileSync(installer, `#!/usr/bin/env node\nconst fs=require('node:fs'),p=require('node:path');const src=${JSON.stringify(marketSource)};const version=JSON.parse(fs.readFileSync(p.join(src,'.codex-plugin/plugin.json'))).version;const dst=p.join(${JSON.stringify(cache)},'personal/clapgrid',version);fs.mkdirSync(dst,{recursive:true});fs.cpSync(src,dst,{recursive:true});if(fs.existsSync(${JSON.stringify(join(root, 'fail'))})){fs.unlinkSync(${JSON.stringify(join(root, 'fail'))});process.exit(1);}console.log('{}');`, { mode: 0o700 });
  const env = { ...process.env, CLAPGRID_CODEX_BIN: host, XDG_DATA_HOME: join(root, 'data') };
  const runtime = async (pkg: string, action: string, idleOnly = false) => JSON.parse((await exec(process.execPath, [join(pkg, 'dist/runtime.js'), action, '--workspace', workspace, '--thread', '00000000-0000-4000-8000-000000000071', ...(idleOnly ? ['--idle-only'] : [])], { env })).stdout);
  t.after(async () => { try { await runtime(marketSource, 'workspace-stop'); } catch {} await new Promise(r => setTimeout(r, 300)); rmSync(root, { recursive: true, force: true }); });
  const before = await runtime(installed(old), 'open');
  await assert.rejects(runtime(next, 'open'), /服务版本.*更新/);
  await fetch(`${before.url}/api/codex/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: [{ kind: 'add', text: '升级后保留的文案' }] }) });
  const args = [join(repo, 'scripts/update-plugin.mjs'), '--package', next, '--marketplace-root', market, '--cache-root', cache,
    '--workspace', workspace, '--thread', '00000000-0000-4000-8000-000000000071', '--installer', installer, '--backup-root', join(root, 'backups')];
  const edit = await beginEdit(before.url);
  assert.equal((await runtime(installed(old), 'workspace-stop', true)).outcome, 'kept', '停止动作也必须保护正在编辑的项目');
  await assert.rejects(exec(process.execPath, args, { env }), /项目有运行任务或正在编辑/);
  assert.equal((await runtime(installed(old), 'workspace-status')).instanceId, before.instanceId);
  edit.close(); await edit.closed;
  const report = JSON.parse((await exec(process.execPath, args, { env })).stdout);
  assert.equal(report.installed, 'verified');
  assert.equal(report.service, 'verified');
  assert.equal(report.host, 'reload-required');
  assert.equal(report.complete, false);
  await assert.rejects(runtime(installed(old), 'open'), /插件版本.*重载/);
  const after = await runtime(installed(next), 'workspace-status');
  assert.notEqual(after.instanceId, before.instanceId);
  assert.equal(after.snapshot.project.id, before.snapshot.project.id);
  assert.equal(after.buildIdentity.contentFingerprint, identity(next).contentFingerprint);
  assert.equal(after.snapshot.segments[0]?.text, '升级后保留的文案');
  assert.ok(existsSync(join(report.backup, 'source/.codex-plugin/plugin.json')));
  const third = await build('third');
  writeFileSync(join(root, 'fail'), '本次安装失败');
  const failed = await exec(process.execPath, args.map(arg => arg === next ? third : arg), { env }).then(() => { throw Error('应该失败'); }, error => JSON.parse(error.stdout));
  assert.equal(failed.rollback, 'restored');
  assert.equal(identity(marketSource).contentFingerprint, identity(next).contentFingerprint);
  const recovered = await runtime(installed(next), 'workspace-status');
  assert.equal(recovered.snapshot.project.id, before.snapshot.project.id);
  assert.equal(recovered.snapshot.segments[0].text, '升级后保留的文案');
  await runtime(installed(next), 'workspace-stop');
  for (let i = 0; i < 100; i++) { try { await fetch(new URL('/api/identity', recovered.url)); } catch { break; } await new Promise(r => setTimeout(r, 20)); }
  const previousHost = process.env.CLAPGRID_CODEX_BIN; process.env.CLAPGRID_CODEX_BIN = host;
  let finish!: (response: Response) => void;
  const taskService = await startService({ workspaceDirectory: workspace, projectDirectory: join(workspace, 'clapgrid'), panelDirectory: join(next, 'dist/panel'), port: 0,
    speechRuntime: { key: () => 'test-only', configPath: join(root, 'test.env'), fetch: async () => new Promise<Response>(resolve => { finish = resolve; }) } });
  try {
    const bound = await runtime(next, 'workspace-status');
    const accepted = await fetch(`${bound.url}/api/speech/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), segmentId: recovered.snapshot.segments[0].id }) });
    assert.equal(accepted.ok, true);
    await assert.rejects(exec(process.execPath, args, { env }), /项目有运行任务或正在编辑/);
    assert.equal((await runtime(next, 'workspace-stop')).outcome, 'kept');
    assert.equal((await runtime(next, 'workspace-status')).instanceId, bound.instanceId);
    finish(new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n'));
    for (let i = 0; i < 100 && (await runtime(next, 'workspace-status')).taskLocked; i++) await new Promise(r => setTimeout(r, 20));
  } finally { await taskService.close(); if (previousHost === undefined) delete process.env.CLAPGRID_CODEX_BIN; else process.env.CLAPGRID_CODEX_BIN = previousHost; }
  const offlineUpdate = JSON.parse((await exec(process.execPath, args.map(arg => arg === next ? third : arg), { env })).stdout);
  assert.equal(offlineUpdate.service, 'verified', '旧服务正常离线后仍能更新');
  assert.equal((await runtime(installed(third), 'workspace-status')).snapshot.project.id, before.snapshot.project.id);
  const receiptPath = join(root, 'data/clapgrid/plugin-update.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, sourceRepository: source }));
  writeFileSync(join(source, 'src/runtime.ts'), readFileSync(join(source, 'src/runtime.ts'), 'utf8') + '\n// 后续提交\n');
  await commit();
  await assert.rejects(runtime(installed(third), 'open'), /源码.*更新/);




});
