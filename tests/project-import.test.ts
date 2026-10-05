import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test } from 'node:test';
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

 test('显式迁入入口要求来源与无运行任务确认，复制后原件保留且拒绝覆盖', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-import-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const source = join(root, 'legacy');
  const business = openBusiness(source); business.addSegment('旧项目文案'); await business.close();
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:r.method==='initialize'?{}:{thread:{id:'11111111-1111-4111-8111-111111111111',cwd:${JSON.stringify(workspace)}}}}));});`, { mode: 0o700 });
  const dist = join(root, 'dist'); mkdirSync(join(dist, 'panel'), { recursive: true }); writeFileSync(join(dist, 'panel', 'index.html'), 'ClapGrid'); writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const entry = join(dist, 'runtime.js');
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts', 'src/mcp/main.ts'], outbase: 'src', outdir: dist, bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);" } });
  const env = { ...process.env, CLAPGRID_CODEX_BIN: host };
  const runtime = (action: string, ...args: string[]) => promisify(execFile)(process.execPath, [entry, action, '--workspace', workspace, '--thread', '11111111-1111-4111-8111-111111111111', ...args], { env });
  const cli = (...args: string[]) => runtime('import-project', ...args);
  const stop = async (opened: { url: string; instanceId: string }) => {
    await fetch(`${opened.url}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: opened.instanceId }) });
    for (let i = 0; i < 100; i++) { try { await fetch(`${opened.url}/api/status`); } catch { return; } await new Promise(resolve => setTimeout(resolve, 20)); }
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
  await assert.rejects(cli('--source', source, '--confirm-idle'), /源项目服务仍在运行/);
  await running.close();
  const legacy = new DatabaseSync(join(source, 'clapgrid.sqlite'));
  const taskId = randomUUID(); const speechId = randomUUID();
  const createdAt = '2026-01-02T03:04:05.000Z';
  const fileName = `2026-01-02T03-04-05-000Z-${taskId}.mp4`;
  const task = { id: taskId, state: 'rendering', createdAt, message: '旧任务', completed: 1, total: 1, issues: [], warnings: [] };
  legacy.prepare('INSERT INTO export_tasks VALUES (?, ?)').run(taskId, JSON.stringify(task));
  legacy.close();
  await assert.rejects(cli('--source', source, '--confirm-idle'), /源项目存在运行任务/);
  const ready = new DatabaseSync(join(source, 'clapgrid.sqlite'));
  const exportTask = { ...task, state: 'succeeded', output: { path: join(source, 'exports', fileName), url: `/api/exports/${taskId}/file` } };
  ready.prepare('UPDATE export_tasks SET value = ? WHERE id = ?').run(JSON.stringify(exportTask), taskId);
  ready.close();
  await assert.rejects(cli('--source', source, '--confirm-idle'), /成片.*文件缺失/);
  assert.equal(existsSync(join(workspace, 'clapgrid')), false, '复制后校验失败不能留下正常项目');
  mkdirSync(join(source, 'exports')); writeFileSync(join(source, 'exports', fileName), '旧成片字节');
  const history = new DatabaseSync(join(source, 'clapgrid.sqlite'));
  const segment = history.prepare('SELECT id FROM segments').get()!;
  const originalId = history.prepare('SELECT id FROM project_identity').get()!.id;
  history.prepare('INSERT INTO speech_tasks VALUES (?, ?, ?)').run(speechId, randomUUID(), JSON.stringify({ id: speechId, requestId: randomUUID(), segmentId: segment.id, input: { text: '旧项目文案', voice: defaultVoice }, state: 'succeeded', message: '完成', createdAt, succeededAt: createdAt }));
  history.close(); writeFileSync(join(source, 'media', `${speechId}.mp3`), '旧配音字节');
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
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const alias = join(root, 'alias'); symlinkSync(workspace, alias);
  const source = join(root, 'source'); const initial = openBusiness(source); initial.addSegment('并发迁入'); await initial.close();
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const marker = join(root, 'waiting'); const counter = join(root, 'counter');
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read'){const n=fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8'))+1:1;fs.writeFileSync(${JSON.stringify(counter)},String(n));if(n===2){fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);}else console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:${JSON.stringify(workspace)}}}}));}});`, { mode: 0o700 });
  const entry = join(root, 'runtime.mjs');
  await build({ entryPoints: ['src/runtime.ts'], outfile: entry, bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);" } });
  const args = [entry, 'import-project', '--workspace', workspace, '--thread', '11111111-1111-4111-8111-111111111111', '--source', source, '--confirm-idle'];
  const pending = promisify(execFile)(process.execPath, args, { env: { ...process.env, CLAPGRID_CODEX_BIN: host } });
  const ended = pending.then(() => 'unexpected-success', () => 'interrupted');
  t.after(() => { pending.child.kill('SIGKILL'); if (existsSync(marker)) { try { process.kill(Number(readFileSync(marker, 'utf8')), 'SIGKILL'); } catch { /* 查询进程已退出。 */ } } });
  for (let i = 0; i < 300 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(existsSync(marker), true, '等待迁入完成复制后的宿主核对');
  await assert.rejects(startService({ projectDirectory: source, panelDirectory, port: 0 }), /另一服务/);
  await assert.rejects(startService({ projectDirectory: join(workspace, 'clapgrid'), panelDirectory, port: 0 }), /迁入/);
  await assert.rejects(startService({ projectDirectory: join(alias, 'clapgrid'), panelDirectory, port: 0 }), /迁入/);
  await assert.rejects(promisify(execFile)(process.execPath, args, { env: { ...process.env, CLAPGRID_CODEX_BIN: host } }), /正在迁入/);
  pending.child.kill('SIGKILL'); assert.equal(await ended, 'interrupted');
  assert.equal(existsSync(join(workspace, 'clapgrid', 'clapgrid.sqlite')), false);
  await assert.rejects(startService({ projectDirectory: join(workspace, 'clapgrid'), panelDirectory, port: 0 }), /迁入/);
});
