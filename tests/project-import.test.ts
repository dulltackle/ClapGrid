import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { startService } from '../src/service/server.js';
import { beginEdit } from '../src/shared/client.js';
import { defaultVoice, statusSchema } from '../src/shared/contracts.js';
import { build } from 'esbuild';
import { openBusiness } from '../src/business/index.js';
import { serviceProcess, waitForServiceExit } from './helpers/service-exit.js';

const { ownerAlive, processIdentity } = await import(new URL('./helpers/product-process.mjs', import.meta.url).href);

// 保留原 Node 文件未显式设置的测试与清理无限时语义。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

 test('显式迁入入口要求来源与无运行任务确认，复制后原件保留且拒绝覆盖', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-import-'));
  const live = new Set<unknown>();
  t.onTestFinished(() => {
    assert.equal(live.size, 0, '尚未确认本例项目资源关闭，保留临时项目');
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const source = join(root, 'legacy');
  const business = openBusiness(source); let businessClosed = false; live.add(business);
  t.onTestFinished(async () => { if (!businessClosed) await business.close(); live.delete(business); });
  business.addSegment('旧项目文案'); await business.close(); businessClosed = true; live.delete(business);
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:r.method==='initialize'?{}:{thread:{id:'11111111-1111-4111-8111-111111111111',cwd:${JSON.stringify(workspace)}}}}));});`, { mode: 0o700 });
  const dist = join(root, 'dist'); mkdirSync(join(dist, 'panel'), { recursive: true }); writeFileSync(join(dist, 'panel', 'index.html'), 'ClapGrid'); writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const entry = join(dist, 'runtime.js');
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts', 'src/mcp/main.ts'], outbase: 'src', outdir: dist, bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);" } });
  const env = { ...process.env, CLAPGRID_CODEX_BIN: host };
  const runtime = (action: string, ...args: string[]) => promisify(execFile)(process.execPath, [entry, action, '--workspace', workspace, '--thread', '11111111-1111-4111-8111-111111111111', ...args], { env });
  const cli = (...args: string[]) => runtime('import-project', ...args);
  const stop = async (opened: { url: string; instanceId: string; pid: number }) => {
    live.add(opened.pid);
    const identity = serviceProcess(opened.pid);
    await fetch(`${opened.url}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: opened.instanceId }) });
    for (let i = 0; i < 100; i++) { try { await fetch(`${opened.url}/api/status`); } catch { await waitForServiceExit(identity); live.delete(opened.pid); return; } await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error('迁入测试服务未退出');
  };
  await assert.rejects(cli('--source', source), /确认无运行任务/);
  assert.equal(existsSync(join(workspace, 'clapgrid')), false);
  writeFileSync(join(source, 'media-active.json'), '{}');
  await assert.rejects(cli('--source', source, '--confirm-idle'), /媒体进程/);
  assert.equal(existsSync(join(workspace, 'clapgrid')), false);
  rmSync(join(source, 'media-active.json'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const running = await startService({ projectDirectory: source, panelDirectory, port: 0 });
  live.add(running);
  t.onTestFinished(async () => { await running.close(); live.delete(running); });
  await assert.rejects(cli('--source', source, '--confirm-idle'), /源项目服务仍在运行/);
  await running.close();
  const legacy = new DatabaseSync(join(source, 'clapgrid.sqlite'));
  let legacyClosed = false;
  t.onTestFinished(() => { if (!legacyClosed) legacy.close(); });
  const taskId = randomUUID(); const speechId = randomUUID();
  const createdAt = '2026-01-02T03:04:05.000Z';
  const fileName = `2026-01-02T03-04-05-000Z-${taskId}.mp4`;
  const task = { id: taskId, state: 'rendering', createdAt, message: '旧任务', completed: 1, total: 1, issues: [], warnings: [] };
  legacy.prepare('INSERT INTO export_tasks VALUES (?, ?)').run(taskId, JSON.stringify(task));
  legacy.close(); legacyClosed = true;
  await assert.rejects(cli('--source', source, '--confirm-idle'), /源项目存在运行任务/);
  const ready = new DatabaseSync(join(source, 'clapgrid.sqlite'));
  let readyClosed = false;
  t.onTestFinished(() => { if (!readyClosed) ready.close(); });
  const exportTask = { ...task, state: 'succeeded', output: { path: join(source, 'exports', fileName), url: `/api/exports/${taskId}/file` } };
  ready.prepare('UPDATE export_tasks SET value = ? WHERE id = ?').run(JSON.stringify(exportTask), taskId);
  ready.close(); readyClosed = true;
  await assert.rejects(cli('--source', source, '--confirm-idle'), /成片.*文件缺失/);
  assert.equal(existsSync(join(workspace, 'clapgrid')), false, '复制后校验失败不能留下正常项目');
  mkdirSync(join(source, 'exports')); writeFileSync(join(source, 'exports', fileName), '旧成片字节');
  const history = new DatabaseSync(join(source, 'clapgrid.sqlite'));
  let historyClosed = false;
  t.onTestFinished(() => { if (!historyClosed) history.close(); });
  const segment = history.prepare('SELECT id FROM segments').get()!;
  const originalId = history.prepare('SELECT id FROM project_identity').get()!.id;
  history.prepare('INSERT INTO speech_tasks VALUES (?, ?, ?)').run(speechId, randomUUID(), JSON.stringify({ id: speechId, requestId: randomUUID(), segmentId: segment.id, input: { text: '旧项目文案', voice: defaultVoice }, state: 'succeeded', message: '完成', createdAt, succeededAt: createdAt }));
  history.close(); historyClosed = true; writeFileSync(join(source, 'media', `${speechId}.mp3`), '旧配音字节');
  const original = readFileSync(join(source, 'clapgrid.sqlite'));
  const result = JSON.parse((await cli('--source', source, '--confirm-idle')).stdout);
  assert.equal(result.projectDirectory, join(workspace, 'clapgrid'));

  assert.deepEqual(readFileSync(join(source, 'clapgrid.sqlite')), original);
  await assert.rejects(cli('--source', source, '--confirm-idle'), /目标已有/);
  renameSync(source, join(root, 'original-kept'));
  const imported = JSON.parse((await runtime('open')).stdout);
  try {
    const status = await (await fetch(`${imported.url}/api/status`)).json();
    assert.notEqual(status.snapshot.project.id, originalId);
    const client = new Client({ name: 'import-regression', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dist, 'mcp/main.js')], env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }));
    try { const mcp = await client.callTool({ name: 'clapgrid_status', arguments: {}, _meta: { threadId: '11111111-1111-4111-8111-111111111111' } }); assert.notEqual(mcp.isError, true); assert.deepEqual(statusSchema.parse(mcp.structuredContent).snapshot, status.snapshot); }
    finally { await client.close(); }
    assert.equal(status.snapshot.segments[0].text, '旧项目文案');
    const exports = await (await fetch(`${imported.url}/api/exports`)).json();
    assert.equal(exports.tasks[0].output.path, join(result.projectDirectory, 'exports', fileName));
    assert.equal(exports.tasks.length, 1, '迁入不重新导出');
    assert.equal(await (await fetch(`${imported.url}/api/exports/${taskId}/file`)).text(), '旧成片字节');
    assert.equal(await (await fetch(`${imported.url}/api/speech/audio/${speechId}`)).text(), '旧配音字节');
    const speech = await (await fetch(`${imported.url}/api/speech`)).json(); assert.equal(speech.tasks.length, 1, '迁入不重新配音');
    const editing = await beginEdit(imported.url);
    try { assert.equal((await fetch(`${imported.url}/api/segments/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Edit-Token': editing.token }, body: JSON.stringify({ id: segment.id, text: '迁入后编辑' }) })).status, 200); }
    finally { await editing.close(); }
  } finally { await stop(imported); }
  const reopened = JSON.parse((await runtime('open')).stdout);
  try { assert.equal((await (await fetch(`${reopened.url}/api/status`)).json()).snapshot.segments[0].text, '迁入后编辑'); }
  finally { await stop(reopened); }
 });

test('迁入发布前阻止并发源修改及目标打开，中断后普通打开不能误认成功', { timeout: 20000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-import-race-'));
  let processesStopped = true;
  t.onTestFinished(() => {
    assert.equal(processesStopped, true, '尚未确认本例迁入进程退出，保留临时项目');
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const alias = join(root, 'alias'); symlinkSync(workspace, alias);
  const source = join(root, 'source'); const initial = openBusiness(source); initial.addSegment('并发迁入'); await initial.close();
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const marker = join(root, 'waiting'); const counter = join(root, 'counter');
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node
const fs=require('node:fs');
const identity=import(${JSON.stringify(new URL('./helpers/product-process.mjs', import.meta.url).href)}).then(({processIdentity})=>{const owner=processIdentity();if(!owner)throw Error('宿主无法读取自己的出生身份');return owner});
require('node:readline').createInterface({input:process.stdin}).on('line',async line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read'){const n=fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8'))+1:1;fs.writeFileSync(${JSON.stringify(counter)},String(n));if(n===2){const temporary=${JSON.stringify(marker)}+'.'+process.pid;fs.writeFileSync(temporary,JSON.stringify(await identity));fs.renameSync(temporary,${JSON.stringify(marker)});setInterval(()=>{},1000);}else console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:${JSON.stringify(workspace)}}}}));}});`, { mode: 0o700 });
  const entry = join(root, 'runtime.mjs');
  await build({ entryPoints: ['src/runtime.ts'], outfile: entry, bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);" } });
  const args = [entry, 'import-project', '--workspace', workspace, '--thread', '11111111-1111-4111-8111-111111111111', '--source', source, '--confirm-idle'];
  const pending = promisify(execFile)(process.execPath, args, { env: { ...process.env, CLAPGRID_CODEX_BIN: host } });
  processesStopped = false;
  const ended = pending.then(() => 'unexpected-success', () => 'interrupted');
  let guardian: ReturnType<typeof serviceProcess> | undefined;
  t.onTestFinished(async () => {
    if (pending.child.exitCode === null) pending.child.kill('SIGKILL');
    await ended;
    // 只消费本次宿主启动时写出的身份，不能从旧 marker 的 PID 重新认领当前进程。
    guardian ??= JSON.parse(readFileSync(marker, 'utf8'));
    assert.ok(guardian && Number.isInteger(guardian.pid) && guardian.pid > 0, '迁入宿主原身份缺失，保留现场');
    const current = processIdentity(guardian.pid);
    if (current) {
      for (const key of ['pidNamespace', 'boot', 'start'] as const) {
        assert.ok(guardian[key], `迁入宿主原身份缺少 ${key}，保留现场`);
        assert.equal(current[key], guardian[key], '迁入宿主身份变化，保留现场');
      }
    }
    const alive = ownerAlive(guardian);
    assert.notEqual(alive, null, '迁入宿主身份未知，保留现场');
    if (alive) process.kill(guardian.pid, 'SIGKILL');
    await waitForServiceExit(guardian);
    processesStopped = true;
  });
  for (let i = 0; i < 300 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(existsSync(marker), true, '等待迁入完成复制后的宿主核对');
  guardian = JSON.parse(readFileSync(marker, 'utf8'));
  await assert.rejects(startService({ projectDirectory: source, panelDirectory, port: 0 }), /另一服务/);
  await assert.rejects(startService({ projectDirectory: join(workspace, 'clapgrid'), panelDirectory, port: 0 }), /迁入/);
  await assert.rejects(startService({ projectDirectory: join(alias, 'clapgrid'), panelDirectory, port: 0 }), /迁入/);
  await assert.rejects(promisify(execFile)(process.execPath, args, { env: { ...process.env, CLAPGRID_CODEX_BIN: host } }), /正在迁入/);
  pending.child.kill('SIGKILL'); assert.equal(await ended, 'interrupted');
  assert.equal(existsSync(join(workspace, 'clapgrid', 'clapgrid.sqlite')), false);
  await assert.rejects(startService({ projectDirectory: join(workspace, 'clapgrid'), panelDirectory, port: 0 }), /迁入/);
});
