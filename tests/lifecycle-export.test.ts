import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openBusiness } from '../src/business/index.js';
import { queryStatus, queryExports, submitExport, modifyBatch, connectTable, querySpeech } from '../src/shared/client.js';

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await read(); if (accept(value)) return value; } catch { /* 启动或关机期间连接不可用。 */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('等待生命周期状态超时');
}

test('真实媒体导出跨客户端重开，服务崩溃后先停止旧媒体再清理，保留成片并从最新输入重新导出', { timeout: 120000, skip: process.platform !== 'linux' }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-crash-'));
  const workspace = join(root, 'workspace'); const otherWorkspace = join(root, 'other'); mkdirSync(otherWorkspace);
  const directory = join(workspace, 'clapgrid'); const video = join(root, 'video.mp4'); const audio = join(root, 'voice.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:d=1', '-c:v', 'libx264', video]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-ar', '24000', audio]);
  const payload = readFileSync(audio).toString('base64');
  const business = openBusiness(directory, { key: () => 'test', configPath: 'test', fetch: (async () => new Response(`data: {"code":0,"data":"${payload}"}\n\ndata: {"code":20000000}\n\n`)) as typeof fetch });
  try {
    const token = business.acquire('codex');
    const segment = business.addSegment('崩溃恢复验证', token).segments[0]!;
    const asset = await business.importVideo(token, { sourcePath: video });
    await business.modifyBatch(token, { changes: [{ kind: 'video', expected: segment, assetId: asset.id, start: 0 }] });
    const expected = business.getSnapshot().exportSettings;
    await business.setExportSettings(token, { expected, settings: { ...expected, fontFamily: 'Noto Sans CJK SC', fontSize: 48 } });
    business.release(token);
    business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
    await until(async () => business.getSpeechStatus(), value => !value.locked);
  } finally { await business.close(); }
  const dist = join(root, 'dist'); mkdirSync(join(dist, 'panel'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}'); writeFileSync(join(dist, 'panel', 'index.html'), 'ClapGrid');
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts', 'src/mcp/main.ts'], outbase: 'src', outdir: dist,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const thread = randomUUID(); const otherThread = randomUUID(); const hostState = join(root, 'host.json');
  const setWorkspace = (current: string) => writeFileSync(hostState, JSON.stringify({ [thread]: current, [otherThread]: workspace }));
  setWorkspace(workspace);
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nconst fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:JSON.parse(fs.readFileSync(${JSON.stringify(hostState)},'utf8'))[r.params.threadId]}}}));});`, { mode: 0o700 });
  const env = { ...process.env, CLAPGRID_CODEX_BIN: host };
  const pids: number[] = []; const residualMedia: number[] = []; const clients: Client[] = [];
  let url = '';
  const start = async (id = thread) => {
    const status = JSON.parse((await promisify(execFile)(process.execPath, [join(dist, 'runtime.js'), 'open', '--workspace', workspace, '--thread', id], { env })).stdout);
    pids.push(status.pid); if (id === thread) url = status.url;
    return { status, url: status.url as string };
  };
  const connectMcp = async () => {
    const client = new Client({ name: 'lifecycle-regression', version: '1' }); clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dist, 'mcp/main.js')], env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }));
    return client;
  };
  const mcpExports = async (client: Client, id = thread) => {
    const response = await client.callTool({ name: 'clapgrid_export_status', arguments: {}, _meta: { threadId: id } });
    assert.notEqual(response.isError, true);
    return response.structuredContent as import('../src/shared/contracts.js').ExportTasksStatus;
  };
  const alive = (pid: number) => {
    try { return !readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.startsWith('Z'); } catch { return false; }
  };
  const kill = async (pid: number) => { process.kill(pid, 'SIGKILL'); await until(async () => alive(pid), value => !value); };
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    for (const pid of residualMedia) { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出。 */ } }
    for (const pid of new Set(pids)) if (alive(pid)) await kill(pid);
    rmSync(root, { recursive: true, force: true });
  });
  const first = await start();
  let client = await connectMcp();
  const panel = await connectTable(url);
  const accepted = await submitExport(url);
  await panel.close(); await client.close();
  const reopened = await start(otherThread);
  assert.equal(reopened.status.instanceId, first.status.instanceId);
  client = await connectMcp();
  assert.equal((await mcpExports(client, otherThread)).tasks[0]!.id, accepted.id);
  assert.equal((await submitExport(url)).id, accepted.id);
  assert.equal((await queryStatus(url)).taskLocked, true);
  const complete = await until(() => queryExports(url), value => !value.locked);
  const output = complete.tasks.find(task => task.id === accepted.id)!;
  assert.equal(output.state, 'succeeded', JSON.stringify(output));
  const original = readFileSync(output.output!.path);
  const shared = (await mcpExports(client, otherThread)).tasks.find(task => task.id === accepted.id)!;
  assert.equal(shared.state, 'succeeded');
  assert.equal(shared.output!.path, output.output!.path);
  assert.deepEqual(Buffer.from(await (await fetch(new URL(shared.output!.url, reopened.url))).arrayBuffer()), original);
  const speech = await querySpeech(url);
  const originalAudio = Buffer.from(await (await fetch(new URL(speech.audio[0]!.url, url))).arrayBuffer());
  const next = await submitExport(url);
  await until(() => queryExports(url), value => value.tasks.some(task => task.id === next.id && task.state === 'rendering'));
  // 从操作系统观察本次真实 FFmpeg，重开解锁时它必须已停止。
  const descendants = (pid: number): number[] => {
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
    return children.flatMap(child => [child, ...descendants(child)]);
  };
  const mediaPids = await until(async () => descendants(first.status.pid).filter(pid => {
    try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'ffmpeg'; } catch { return false; }
  }), value => value.length > 0);
  residualMedia.push(...mediaPids);
  for (const pid of mediaPids) process.kill(pid, 'SIGSTOP');
  const oldUrl = url;
  setWorkspace(otherWorkspace);
  assert.equal((await fetch(`${oldUrl}/api/status`)).status, 409);
  assert.equal((await queryStatus(reopened.url)).taskLocked, true);
  assert.equal((await mcpExports(client, otherThread)).tasks.find(task => task.id === next.id)!.state, 'rendering');
  setWorkspace(workspace);
  assert.equal((await fetch(`${oldUrl}/api/status`)).status, 409, '回到原目录不能复活旧绑定');
  const returned = await start();
  assert.equal(returned.status.instanceId, first.status.instanceId);
  assert.equal((await queryExports(url)).tasks.find(task => task.id === next.id)!.state, 'rendering');
  process.kill(first.status.pid, 'SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await queryStatus(url)).instanceId, first.status.instanceId);
  assert.equal((await queryStatus(url)).taskLocked, true);
  for (const pid of mediaPids) process.kill(pid, 'SIGCONT');
  const previousBinding = url;
  await kill(first.status.pid);
  const second = await start();
  assert.equal(second.status.snapshot.project.id, first.status.snapshot.project.id);
  assert.notEqual(second.status.instanceId, first.status.instanceId);
  assert.equal((await fetch(new URL(url).origin + new URL(previousBinding).pathname + '/api/status')).status, 409);
  const recovered = await until(() => queryExports(url), value => !value.locked);
  for (const pid of mediaPids) {
    let alive = false;
    try { alive = !readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.startsWith('Z'); } catch { /* 已回收。 */ }
    assert.equal(alive, false, `重开解锁时旧媒体进程 ${pid} 仍存活`);
  }
  assert.equal(recovered.tasks.find(task => task.id === next.id)!.state, 'interrupted');
  assert.equal(recovered.tasks.length, 2, '恢复不能自动重新导出');
  assert.deepEqual((await mcpExports(client)).tasks, recovered.tasks);
  const savedSpeech = await querySpeech(url);
  assert.deepEqual(savedSpeech.tasks, speech.tasks);
  assert.deepEqual(Buffer.from(await (await fetch(new URL(savedSpeech.audio[0]!.url, url))).arrayBuffer()), originalAudio);
  assert.deepEqual(Buffer.from(await (await fetch(new URL(recovered.tasks[0]!.output!.url, url))).arrayBuffer()), original);
  assert.deepEqual(readFileSync(output.output!.path), original);
  assert.equal(existsSync(join(directory, 'exports', `.work-${next.id}`)), false);
  assert.deepEqual(readdirSync(join(directory, 'exports')), [output.output!.path.split('/').at(-1)]);
  const segment = second.status.snapshot.segments[0]!;
  await modifyBatch(url, { changes: [{ kind: 'edit', expected: segment, text: '最新输入需要更新配音' }] });
  const retry = await submitExport(url);
  const retried = await until(() => queryExports(url), value => !value.locked);
  const failed = retried.tasks.find(task => task.id === retry.id)!;
  assert.equal(failed.state, 'failed');
  assert.ok(failed.issues.some(issue => /配音待更新/.test(issue.message)));
  assert.deepEqual(readFileSync(output.output!.path), original);
  const current = (await queryStatus(url)).snapshot.segments[0]!;
  await modifyBatch(url, { changes: [{ kind: 'edit', expected: current, text: segment.text }] });
  const guarded = await submitExport(url);
  await until(() => queryExports(url), value => value.tasks.some(task => task.id === guarded.id && task.state === 'rendering'));
  const active = await until(async () => descendants(second.status.pid).filter(pid => {
    try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'ffmpeg'; } catch { return false; }
  }), value => value.length > 0);
  residualMedia.push(...active);
  for (const pid of active) process.kill(pid, 'SIGSTOP');
  const guardianPid = Number(readFileSync(join(directory, 'media-active.json'), 'utf8').match(/"guardianPid":(\d+)/)![1]);
  process.kill(guardianPid, 'SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await queryStatus(url)).taskLocked, true);
  assert.equal(existsSync(join(directory, 'exports', `.work-${guarded.id}`)), true);
  await kill(second.status.pid);
  await assert.rejects(start(), /服务启动未确认/);
  assert.match(readFileSync(join(directory, 'service.log'), 'utf8'), /尚未确认子进程终止/);
  assert.equal(existsSync(join(directory, 'exports', `.work-${guarded.id}`)), true);
  assert.deepEqual(readFileSync(output.output!.path), original);
});
