import { beginEdit, connectTable, queryStatus, querySpeech } from '../src/shared/client.js';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('打包入口按宿主工作空间打开，表格与业务 MCP 一致，切换及服务重启使旧连接失效', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-workspace-'));
  const dist = join(root, 'dist'); const first = join(root, 'first'); const second = join(root, 'second');
  mkdirSync(first); mkdirSync(second); mkdirSync(join(dist, 'panel'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dist, 'panel', 'index.html'), '<title>ClapGrid</title>');
  const threadId = randomUUID(); const state = join(root, 'host.json');
  const setWorkspace = (cwd: string | null, delay = 0) => writeFileSync(state, JSON.stringify({ id: threadId, cwd, delay }));
  setWorkspace(first);
  const occupied = createServer((_request, response) => response.end('保留原服务'));
  const ownsDefaultPort = await new Promise<boolean>((resolve, reject) => {
    occupied.once('error', (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    occupied.listen(48762, '127.0.0.1', () => resolve(true));
  });
  t.after(() => { if (ownsDefaultPort) occupied.close(); });
  const host = join(root, 'host.cjs');
  const queryStarted = join(root, 'host-query-started');
  writeFileSync(host, `#!/usr/bin/env node\nconst fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read'){const thread=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'));if(thread.delay)fs.writeFileSync(${JSON.stringify(queryStarted)},'started');setTimeout(()=>console.log(JSON.stringify({id:r.id,result:{thread}})),thread.delay);}});\n`, { mode: 0o700 });
  const identity = { schemaVersion: 1, state: 'known', version: 'test', source: { commit: null, state: 'clean' }, contentFingerprint: 'sha256:' + 'a'.repeat(64) };
  const env = { ...process.env, CLAPGRID_CODEX_BIN: host, XDG_DATA_HOME: join(root, 'data') };
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts', 'src/mcp/main.ts'], outbase: 'src', outdir: dist,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'],
    define: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(identity) },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const cli = async (action: string, workspace?: string) => JSON.parse((await promisify(execFile)(process.execPath,
    [join(dist, 'runtime.js'), action, ...(workspace ? ['--workspace', workspace, '--thread', threadId] : [])], { env })).stdout);
  const running = new Map<string, { id: string; boundUrl: string; workspace: string }>();
  const stop = async (url: string, instanceId: string) => {
    const record = running.get(url)!; setWorkspace(record.workspace);
    record.boundUrl = (await cli('open', record.workspace)).url;
    await fetch(`${record.boundUrl}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId }) });
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${url}/api/identity`); } catch { running.delete(url); return; }
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('服务未退出');
  };
  t.after(async () => {
    for (const [url, record] of running) await stop(url, record.id);
    rmSync(root, { recursive: true, force: true });
  });
  await assert.rejects(cli('open'), /选择或创建本地工作空间/);
  assert.equal(existsSync(join(first, 'clapgrid')), false);
  setWorkspace(null);
  await assert.rejects(cli('open', first), /选择或创建工作空间/);
  assert.equal(existsSync(join(first, 'clapgrid')), false, '宿主无有效目录时不得建立项目或启动服务');
  setWorkspace(first);
  const opened = await cli('open', first);
  const origin = new URL(opened.url).origin; running.set(origin, { id: opened.instanceId, boundUrl: opened.url, workspace: first });
  assert.notEqual(origin, 'http://127.0.0.1:48762');
  if (ownsDefaultPort) assert.equal(await (await fetch('http://127.0.0.1:48762')).text(), '保留原服务');
  assert.equal(opened.snapshot.project.directory, join(first, 'clapgrid'));
  assert.equal((await fetch(`${origin}/api/status`)).status, 409);
  // 宿主查询尚未完成时关闭面板请求，不能留下编辑占用或幽灵表格。
  for (const endpoint of ['edit-session', 'table-session']) {
    rmSync(queryStarted, { force: true });
    setWorkspace(first, 250);
    const abandoned = request(`${opened.url}/api/${endpoint}`, { method: 'POST' });
    abandoned.on('error', () => {}); abandoned.end();
    for (let i = 0; !existsSync(queryStarted) && i < 200; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(existsSync(queryStarted), true, '请求应已进入宿主身份核对');
    abandoned.destroy();
    await new Promise(r => setTimeout(r, 500));
    setWorkspace(first);
  }
  assert.equal((await (await fetch(`${opened.url}/api/status`)).json()).modification, null, '断线请求不应残留修改权');
  const selection = await (await fetch(`${opened.url}/api/segments/query`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: { kind: 'all' } }) })).json();
  assert.deepEqual(selection.tables, [], '断线请求不应残留表格');
  const alias = join(root, 'alias'); symlinkSync(first, alias);
  const again = await cli('open', alias);
  assert.equal(again.instanceId, opened.instanceId);
  assert.equal(again.snapshot.project.id, opened.snapshot.project.id);
  await promisify(execFile)('git', ['init', '--quiet', first]);
  await promisify(execFile)('git', ['-C', first, 'commit', '--allow-empty', '-m', 'test: 创建工作空间回归基线'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'ClapGrid 测试', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'ClapGrid 测试', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  });
  await promisify(execFile)('git', ['-C', first, 'checkout', '-b', 'workspace-regression']);
  await promisify(execFile)('git', ['-C', first, 'worktree', 'add', '-b', 'other-workspace', second]);
  assert.equal((await cli('open', first)).snapshot.project.id, opened.snapshot.project.id);
  const client = new Client({ name: 'workspace-regression', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dist, 'mcp/main.js')], env: Object.fromEntries(Object.entries(env).filter((e): e is [string,string] => typeof e[1] === 'string')) }));
  t.after(() => client.close());
  const tool = (name: string, args = {}) => client.callTool({ name, arguments: args, _meta: { threadId } });
  const ready = await tool('clapgrid_prepare_panel');
  assert.notEqual(ready.isError, true);
  const prepared = ready.structuredContent as Record<string, any>;
  assert.equal(prepared.state, 'ready');
  assert.equal(prepared.instanceId, opened.instanceId);
  assert.equal(prepared.project.id, opened.snapshot.project.id);
  assert.equal(prepared.workspace, first);
  assert.deepEqual(prepared.buildIdentity, identity);
  assert.equal((await queryStatus(prepared.url)).instanceId, opened.instanceId);
  assert.equal('snapshot' in prepared, false, '快捷入口不传输整份片段和素材');
  assert.equal((await client.callTool({ name: 'clapgrid_prepare_panel', arguments: {} })).isError, true);
  for (const fingerprint of ['sha256:' + 'b'.repeat(64), null]) {
    const alternate = join(dist, 'alternate-mcp.js');
    await build({ entryPoints: ['src/mcp/main.ts'], outfile: alternate, bundle: true, platform: 'node', format: 'esm', target: 'node22',
      define: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(fingerprint ? { ...identity, contentFingerprint: fingerprint } : { schemaVersion: 1, state: 'unknown' }) },
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
    const alternateClient = new Client({ name: 'version-check', version: '1' });
    try {
      await alternateClient.connect(new StdioClientTransport({ command: process.execPath, args: [alternate], env: Object.fromEntries(Object.entries(env).filter((e): e is [string,string] => typeof e[1] === 'string')) }));
      const rejected = await alternateClient.callTool({ name: 'clapgrid_prepare_panel', arguments: {}, _meta: { threadId } });
      assert.equal(rejected.isError, true, '版本不一致或未知时不得返回快速打开地址');
    } finally { await alternateClient.close(); }
  }
  const saved = await tool('clapgrid_modify', { changes: [{ kind: 'add', text: '工作空间绑定回归' }] });
  assert.notEqual(saved.isError, true);
  const panel = await (await fetch(`${opened.url}/api/status`)).json();
  assert.equal(panel.snapshot.segments[0].text, '工作空间绑定回归');
  const noIdentity = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'add', text: '不应写入' }] } });
  assert.equal(noIdentity.isError, true);
  const editing = await beginEdit(opened.url);
  const duringEdit = await tool('clapgrid_prepare_panel');
  assert.equal((duringEdit.structuredContent as any).state, 'ready');
  assert.deepEqual((duringEdit.structuredContent as any).modification, { owner: 'user' });
  const table = await connectTable(opened.url);
  setWorkspace(second);
  await assert.rejects(queryStatus(opened.url), /关闭重开/);
  setWorkspace(first);
  const reverified = await cli('open', first);
  assert.equal((await queryStatus(reverified.url)).modification, null, '绑定撤销立即释放旧代次修改权，无需等待心跳');
  setWorkspace(second);
  await Promise.race([Promise.all([editing.closed, table.closed]), new Promise((_, reject) => setTimeout(() => reject(new Error('旧工作空间连接未释放')), 3500))]);
  assert.equal((await fetch(`${origin}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: opened.instanceId, interrupt: true }) })).status, 409);
  assert.equal((await fetch(`${opened.url}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: opened.instanceId, interrupt: true }) })).status, 409);
  assert.equal((await fetch(`${opened.url}/api/status`)).status, 409);
  await assert.rejects(queryStatus(opened.url), /关闭重开/);
  await assert.rejects(querySpeech(opened.url), /关闭重开/);
  assert.equal((await tool('clapgrid_modify', { changes: [{ kind: 'add', text: '不应写入原项目' }] })).isError, true);
  const needsStart = await tool('clapgrid_prepare_panel');
  assert.deepEqual(needsStart.structuredContent, { state: 'needs-start', workspace: second, threadId });
  assert.equal(existsSync(join(second, 'clapgrid')), false, '快捷打开离线工作空间不创建项目');
  const other = await cli('open', second);
  const otherOrigin = new URL(other.url).origin; running.set(otherOrigin, { id: other.instanceId, boundUrl: other.url, workspace: second });
  assert.notEqual(otherOrigin, origin);
  assert.notEqual(other.snapshot.project.id, opened.snapshot.project.id);
  setWorkspace(null);
  await assert.rejects(cli('open', second), /选择或创建工作空间/);
  assert.equal((await tool('clapgrid_status')).isError, true);
  assert.equal((await fetch(`${other.url}/api/status`)).status, 409);
  setWorkspace(first);
  assert.equal((await fetch(`${opened.url}/api/status`)).status, 409, '回到原目录不能复活已经失效的旧面板绑定');
  const returnOpened = await cli('open', first);
  assert.equal(returnOpened.instanceId, opened.instanceId);
  assert.equal((await fetch(`${returnOpened.url}/api/status`)).status, 200);
  await stop(origin, opened.instanceId);
  assert.equal(((await tool('clapgrid_prepare_panel')).structuredContent as any)?.state, 'needs-start');
  const replacement = createServer((_request, response) => { response.statusCode = 404; response.end('其他服务'); });
  await new Promise<void>(resolve => replacement.listen(Number(new URL(origin).port), '127.0.0.1', resolve));
  t.after(() => replacement.close());
  assert.equal((await tool('clapgrid_prepare_panel')).isError, true, '地址被其他服务占用时不得回退启动');
  const reopened = await cli('open', first);
  const reopenedOrigin = new URL(reopened.url).origin; running.set(reopenedOrigin, { id: reopened.instanceId, boundUrl: reopened.url, workspace: first });
  assert.equal(reopened.snapshot.project.id, opened.snapshot.project.id);
  assert.equal(reopened.snapshot.segments.length, 1);
  assert.notEqual(reopened.instanceId, opened.instanceId);
  assert.equal(await (await fetch(origin)).text(), '其他服务');
  const stalePath = new URL(opened.url).pathname;
  assert.equal((await fetch(`${reopenedOrigin}${stalePath}/api/status`)).status, 409);
  assert.equal((await tool('clapgrid_status')).isError, undefined);
  const record = JSON.parse(readFileSync(join(first, 'clapgrid', 'service.json'), 'utf8'));
  assert.equal(record.instanceId, reopened.instanceId);
  const receiptDir = join(env.XDG_DATA_HOME, 'clapgrid'); mkdirSync(receiptDir, { recursive: true });
  writeFileSync(join(receiptDir, 'plugin-update.json'), JSON.stringify({ identity: { ...identity, contentFingerprint: 'sha256:' + 'b'.repeat(64) } }));
  assert.equal((await tool('clapgrid_prepare_panel')).isError, true, '旧宿主插件不能通过快速打开');
  rmSync(join(receiptDir, 'plugin-update.json'));
});
