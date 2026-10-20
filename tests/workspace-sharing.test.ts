import { projectCleanup } from './helpers/project-cleanup.js';
import { execCommand } from './helpers/vitest-command.js';
import { test, expect, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startService } from '../src/service/server.js';
import { createBusinessMcp } from '../src/mcp/server.js';
import { beginEdit, queryStatus, querySpeech, submitSpeech, connectTable } from '../src/shared/client.js';
import type { ServiceStatus, SpeechTask, SpeechStatus } from '../src/shared/contracts.js';
import { serviceProcess, waitForServiceExit } from './helpers/service-exit.js';


// 只替代宿主协议和外部配音供应商；真实入口、服务、绑定、HTTP、MCP 与持久化均参与。
test('同工作空间并发打开复用项目与服务，不同工作空间独立', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-sharing-open-'));
  projectCleanup(t).directory(root);
  const first = join(root, 'first'); const second = join(root, 'second'); const dist = join(root, 'dist');
  mkdirSync(first); mkdirSync(second); mkdirSync(join(dist, 'panel'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dist, 'panel', 'index.html'), 'ClapGrid');
  const threads = [randomUUID(), randomUUID(), randomUUID()];
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nconst roots=${JSON.stringify({ [threads[0]!]: first, [threads[1]!]: first, [threads[2]!]: second })};require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:roots[r.params.threadId]}}}));});`, { mode: 0o700 });
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts'], outbase: 'src', outdir: dist, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const cli = async (action: string, workspace: string, thread: string) => JSON.parse((await execCommand(process.execPath, [join(dist, 'runtime.js'), action, '--workspace', workspace, '--thread', thread], { env: { ...process.env, CLAPGRID_CODEX_BIN: host } })).stdout);
  const opened: { workspace: string; thread: string; result: ServiceStatus & { url: string }; process: ReturnType<typeof serviceProcess> }[] = [];

  const results = await Promise.allSettled(threads.map(async (thread, i) => {
    const workspace = i === 2 ? second : first;
    const result = await cli('open', workspace, thread); opened.push({ workspace, thread, result, process: serviceProcess(result.pid) }); projectCleanup(t).process(serviceProcess(result.pid)); return result;
  }));
  for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) + '\n' + [first, second].map(workspace => { try { return readFileSync(join(workspace, 'clapgrid', 'service.log'), 'utf8'); } catch { return ''; } }).join('\n') : undefined);
  const [a, b, c] = results.map(result => (result as PromiseFulfilledResult<ServiceStatus & { url: string }>).value);
  assert.equal(a!.instanceId, b!.instanceId); assert.equal(a!.snapshot.project.id, b!.snapshot.project.id);
  assert.notEqual(a!.instanceId, c!.instanceId); assert.notEqual(a!.snapshot.project.id, c!.snapshot.project.id);
  assert.equal(a!.snapshot.project.directory, join(first, 'clapgrid')); assert.equal(c!.snapshot.project.directory, join(second, 'clapgrid'));
  assert.notEqual(a!.url, b!.url, '共享项目仍使用各自聊天绑定');
});

test('绑定入口两端共享修改权、任务和去重，另一个工作空间并行配音且产物隔离', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-sharing-tasks-'));
  projectCleanup(t).directory(root);
  const first = join(root, 'first'); const second = join(root, 'second'); const panelDirectory = join(root, 'panel');
  mkdirSync(first); mkdirSync(second); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const threads = [randomUUID(), randomUUID(), randomUUID()]; const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nconst roots=${JSON.stringify({ [threads[0]!]: first, [threads[1]!]: first, [threads[2]!]: second })};require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:roots[r.params.threadId]}}}));});`, { mode: 0o700 });
  const previous = process.env.CLAPGRID_CODEX_BIN; process.env.CLAPGRID_CODEX_BIN = host;
  t.onTestFinished(() => { if (previous === undefined) delete process.env.CLAPGRID_CODEX_BIN; else process.env.CLAPGRID_CODEX_BIN = previous; });
  const services: Awaited<ReturnType<typeof startService>>[] = [];
  const clients: Client[] = []; const servers: ReturnType<typeof createBusinessMcp>[] = [];

  projectCleanup(t).connection(() => ({ close: () => Promise.all(clients.map(client => client.close())) }));
  projectCleanup(t).connection(() => ({ close: () => Promise.all(servers.map(server => server.close())) }));
  const gates = [0, 1].map(() => {
    let finish!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    return { finish, response, calls: 0 };
  });
  for (const [i, workspace] of [first, second].entries()) services.push(await projectCleanup(t).startService({
    projectDirectory: join(workspace, 'clapgrid'), workspaceDirectory: workspace, panelDirectory, port: 0,
    speechRuntime: { configPath: '/tmp/clapgrid-test-provider.env', key: () => 'test-only', fetch: (async () => { gates[i]!.calls++; return gates[i]!.response; }) as typeof fetch },
  }));
  // 正式打开命令发现上述真实 HTTP 服务；供应商边界用可控制响应，避免实际收费。
  const dist = join(root, 'dist'); writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  await build({ entryPoints: ['src/runtime.ts'], outbase: 'src', outdir: dist, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
  const open = async (i: number) => JSON.parse((await execCommand(process.execPath, [join(dist, 'runtime.js'), 'open', '--workspace', i === 2 ? second : first, '--thread', threads[i]!], { env: process.env })).stdout) as ServiceStatus & { url: string };
  const [a, b, c] = await Promise.all([open(0), open(1), open(2)]);
  assert.equal(a!.instanceId, b!.instanceId); assert.notEqual(a!.snapshot.project.id, c!.snapshot.project.id);
  const newClient = async () => {
    const server = createBusinessMcp(); const client = new Client({ name: '工作空间共享回归', version: '1' });
    const [outgoing, incoming] = InMemoryTransport.createLinkedPair(); servers.push(server); clients.push(client);
    await server.connect(incoming); await client.connect(outgoing); return client;
  };
  let client = await newClient();
  const tool = async (i: number, name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args, _meta: { threadId: threads[i]! } });
  assert.notEqual((await tool(0, 'clapgrid_modify', { changes: [{ kind: 'add', text: '第一个工作空间' }] })).isError, true);
  const edit = await beginEdit(a!.url);
  try {
    await assert.rejects(beginEdit(b!.url), /修改|编辑|占用/);
    assert.equal((await tool(1, 'clapgrid_modify', { changes: [{ kind: 'add', text: '不得覆盖' }] })).isError, true);
    assert.notEqual((await tool(2, 'clapgrid_modify', { changes: [{ kind: 'add', text: '第二个工作空间' }] })).isError, true);
  } finally { await edit.close(); }
  const firstStatus = await queryStatus(b!.url); const secondStatus = await queryStatus(c!.url);
  assert.deepEqual(firstStatus.snapshot.segments.map(segment => segment.text), ['第一个工作空间']);
  assert.deepEqual(secondStatus.snapshot.segments.map(segment => segment.text), ['第二个工作空间']);
  const request = { requestId: randomUUID(), segmentId: firstStatus.snapshot.segments[0]!.id };
  const table = await connectTable(a!.url);
  const task = await submitSpeech(a!.url, request);
  await table.close(); await client.close(); client = await newClient();
  const reopened = await open(1);
  assert.equal(reopened.instanceId, a!.instanceId); assert.equal(reopened.taskLocked, true);
  const replay = await tool(1, 'clapgrid_submit_speech', request);
  assert.notEqual(replay.isError, true); assert.equal((replay.structuredContent as SpeechTask).id, task.id);
  assert.equal((await tool(1, 'clapgrid_modify', { changes: [{ kind: 'add', text: '锁内写入' }] })).isError, true);
  await assert.rejects(beginEdit(b!.url), /配音/);
  assert.equal((await queryStatus(c!.url)).taskLocked, false);
  const otherRequest = { requestId: request.requestId, segmentId: secondStatus.snapshot.segments[0]!.id };
  const other = await tool(2, 'clapgrid_submit_speech', otherRequest);
  assert.notEqual(other.isError, true); const otherTask = other.structuredContent as SpeechTask;
  assert.notEqual(otherTask.id, task.id, '同一请求标识在不同项目互不干扰');
  const running = await Promise.all([querySpeech(a!.url), querySpeech(b!.url), querySpeech(c!.url)]);
  for (const state of running) assert.equal(state.locked, true);
  assert.equal(running[0]!.tasks[0]!.id, task.id); assert.equal(running[1]!.tasks[0]!.id, task.id);
  assert.equal(running[2]!.tasks[0]!.id, otherTask.id);
  assert.equal(running[0]!.tasks[0]!.state, 'running'); assert.equal(running[2]!.tasks[0]!.state, 'running');
  gates[0]!.finish(new Response('data: {"code":0,"data":"SUQzZmlyc3Q="}\n\ndata: {"code":20000000}\n\n'));
  const settled = (url: string) => vi.waitFor(async () => {
    const status = await querySpeech(url); assert.equal(status.locked, false, JSON.stringify(status)); return status;
  });
  const completed = await settled(a!.url);
  assert.equal(completed.tasks[0]!.state, 'succeeded'); assert.equal((await queryStatus(b!.url)).taskLocked, false);
  assert.equal((await queryStatus(c!.url)).taskLocked, true, '一个项目解锁不影响另一个项目');
  const taskFromMcp = (await tool(1, 'clapgrid_speech_status')).structuredContent as SpeechStatus;
  assert.deepEqual(taskFromMcp.tasks, completed.tasks);
  const audio = completed.audio[0]!;
  assert.equal(await (await fetch(new URL(audio.url, a!.url))).text(), 'ID3first');
  assert.equal((await fetch(`${c!.url}/api/speech/audio/${task.id}`)).status, 404);
  gates[1]!.finish(new Response('data: {"code":0,"data":"SUQzc2Vjb25k"}\n\ndata: {"code":20000000}\n\n'));
  const otherCompleted = await settled(c!.url);
  assert.equal(otherCompleted.tasks[0]!.state, 'succeeded');
  assert.equal(await (await fetch(new URL(otherCompleted.audio[0]!.url, c!.url))).text(), 'ID3second');
  assert.equal((await fetch(`${a!.url}/api/speech/audio/${otherTask.id}`)).status, 404);
  assert.equal((await tool(1, 'clapgrid_submit_speech', request)).isError, undefined);
  assert.equal((await tool(2, 'clapgrid_submit_speech', otherRequest)).isError, undefined);
  assert.deepEqual(gates.map(gate => gate.calls), [1, 1], '重连和重发不重复请求供应商');
});

test('并发打开全部返回后停止服务，不得由迟到启动候选复活', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-sharing-stop-'));
  projectCleanup(t).directory(root);
  const workspace = join(root, 'workspace'); const dist = join(root, 'dist');
  mkdirSync(workspace); mkdirSync(join(dist, 'panel'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dist, 'panel', 'index.html'), 'ClapGrid');
  const threads = [randomUUID(), randomUUID()]; const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:${JSON.stringify(workspace)}}}}));});`, { mode: 0o700 });
  const identities = join(root, 'started-processes.jsonl'); const observer = join(root, 'observe-starts.mjs');
  // 只观察公开 CLI 真正创建的子进程；保留原 spawn 行为、出生身份和所有候选，不按进程名筛选。
  writeFileSync(observer, `import cp from'node:child_process';import{appendFileSync}from'node:fs';import{syncBuiltinESMExports}from'node:module';import{processIdentity}from${JSON.stringify(new URL('./helpers/product-process.mjs', import.meta.url).href)};const original=cp.spawn;cp.spawn=(...args)=>{const child=original(...args);child.once('spawn',()=>{const identity=processIdentity(child.pid);if(!identity)throw Error('无法确认启动候选的出生身份');appendFileSync(${JSON.stringify(identities)},JSON.stringify(identity)+'\\n');});return child;};syncBuiltinESMExports();`);
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts'], outbase: 'src', outdir: dist, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const cli = async (action: string, thread = threads[0]!, extra: string[] = []) => JSON.parse((await execCommand(process.execPath, ['--import', observer, join(dist, 'runtime.js'), action, '--workspace', workspace, '--thread', thread, ...extra], { env: { ...process.env, CLAPGRID_CODEX_BIN: host } })).stdout);

  const opened = await Promise.all(threads.map(thread => cli('open', thread)));
  assert.equal(opened[0].instanceId, opened[1].instanceId);
  const original = serviceProcess(opened[0].pid);
  // 返回赢家退出不足以证明另一个启动候选已经收尾。
  const candidates = readFileSync(identities, 'utf8').trim().split('\n').map(line => JSON.parse(line) as ReturnType<typeof serviceProcess>);
  await cli('workspace-stop'); await waitForServiceExit(original);
  await new Promise(resolve => setTimeout(resolve, 1200));
  const status = await cli('workspace-status', threads[0], ['--allow-offline']);
  const ended = await Promise.allSettled(candidates.map(identity => waitForServiceExit(identity, { timeoutMs: 2000 })));
  await t.annotate(JSON.stringify({ event: 'concurrent-open-candidates-ended', candidates, allOriginalCandidatesExited: ended.every(result => result.status === 'fulfilled'), stateAfterStop: status.state ?? 'online' }));
  assert.equal(status.state, 'offline', '所有 open 返回后停止，服务不得被迟到候选重新打开');
  assert.ok(ended.every(result => result.status === 'fulfilled'), '必须确认原出生身份的全部启动候选已退出');
});
