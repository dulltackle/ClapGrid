import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBusinessMcp } from '../src/mcp/server.js';
import { startService } from '../src/service/server.js';
import { connectTable, importVideo, modifyBatch, queryExports, queryExportSettings, querySpeech, queryStatus, saveExportSettings, submitExport, submitSpeech } from '../src/shared/client.js';

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await read(); if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('等待任务状态超时');
}

for (const outcome of ['成功', '明确失败', '中断'] as const) test(`可导出项目在配音及表格重连期间拒绝 HTTP 和 MCP 导出，${outcome}后恢复校验`, { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-speech-export-'));
  const projectDirectory = join(root, 'project'); const panelDirectory = join(root, 'panel');
  mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), '验收');
  const video = join(root, 'video.mp4'); const audio = join(root, 'audio.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:d=1', '-c:v', 'libx264', video]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-ar', '24000', audio]);
  const bytes = readFileSync(audio);
  const success = () => new Response(`data: {"code":0,"data":"${bytes.toString('base64')}"}\n\ndata: {"code":20000000}\n\n`);
  let hold = false; let finish!: (response: Response) => void;
  const options = { projectDirectory, panelDirectory, port: 0, speechRuntime: {
    configPath: '测试配置', key: () => '测试密钥', fetch: (async () => hold ? new Promise<Response>(resolve => { finish = resolve; }) : success()) as typeof fetch,
  } };
  let service = await startService(options);
  const mcp = createBusinessMcp(service.url); const client = new Client({ name: '配音导出锁回归', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  let table = await connectTable(service.url);
  t.after(async () => { finish?.(success()); await table.close(); await client.close(); await mcp.close(); await service.close(); rmSync(root, { recursive: true, force: true }); });
  await modifyBatch(service.url, { changes: [{ kind: 'add', text: '配音任务锁验证' }] });
  const segment = (await queryStatus(service.url)).snapshot.segments[0]!;
  const { asset } = await importVideo(service.url, video);
  await modifyBatch(service.url, { changes: [{ kind: 'video', expected: segment, assetId: asset.id, start: 0 }] });
  const { settings } = await queryExportSettings(service.url);
  await saveExportSettings(service.url, { expected: settings, settings: { ...settings, fontFamily: 'Noto Sans CJK SC', fontSize: 48 } });
  await submitSpeech(service.url, { requestId: randomUUID(), segmentId: segment.id });
  await until(() => querySpeech(service.url), value => !value.locked);
  const baseline = await submitExport(service.url);
  const complete = await until(() => queryExports(service.url), value => !value.locked);
  assert.equal(complete.tasks.find(task => task.id === baseline.id)!.state, 'succeeded', JSON.stringify(complete));
  const files = readdirSync(join(projectDirectory, 'exports'));
  const original = await queryStatus(service.url);
  hold = true;
  const task = await submitSpeech(service.url, { requestId: randomUUID(), segmentId: segment.id });
  assert.equal(task.state, 'accepted');
  await until(() => querySpeech(service.url), value => value.tasks.some(item => item.id === task.id && item.state === 'running'));
  for (const reopen of [false, true]) {
    if (reopen) { await table.close(); table = await connectTable(service.url); }
    await assert.rejects(submitExport(service.url), /配音任务尚未结束/);
    const rejected = await client.callTool({ name: 'clapgrid_submit_export', arguments: {} });
    assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected.content), /配音任务尚未结束/);
    assert.deepEqual(await queryExports(service.url), complete);
    assert.deepEqual(readdirSync(join(projectDirectory, 'exports')), files);
    const status = await queryStatus(service.url);
    assert.equal(status.instanceId, original.instanceId); assert.deepEqual(status.snapshot.project, original.snapshot.project); assert.equal(status.taskLocked, true);
    const speech = await querySpeech(service.url);
    assert.equal(speech.tasks.at(-1)!.id, task.id); assert.equal(speech.tasks.at(-1)!.state, 'running');
    const playback = await fetch(`${service.url}${speech.audio[0]!.url}`);
    assert.equal(playback.status, 200); assert.deepEqual(Buffer.from(await playback.arrayBuffer()), bytes);
    const progress = await client.callTool({ name: 'clapgrid_speech_status', arguments: {} });
    assert.notEqual(progress.isError, true);
  }
  if (outcome === '中断') {
    await table.close(); await service.close(); finish(success());
    service = await startService(options);
  } else finish(outcome === '成功' ? success() : new Response('供应商明确拒绝', { status: 401 }));
  const speech = await until(() => querySpeech(service.url), value => !value.locked);
  assert.equal(speech.tasks.at(-1)!.state, outcome === '成功' ? 'succeeded' : outcome === '明确失败' ? 'failed' : 'unknown');
  assert.equal((await queryStatus(service.url)).taskLocked, false);
  assert.equal(speech.tasks.length, 2);
  assert.deepEqual(await queryExports(service.url), complete, '配音结束不会自动导出');
  const current = (await queryStatus(service.url)).snapshot.segments[0]!;
  await modifyBatch(service.url, { changes: [{ kind: 'edit', expected: current, text: '修改文案后必须重新校验配音' }] });
  const next = await submitExport(service.url);
  const result = await until(() => queryExports(service.url), value => !value.locked);
  const rejected = result.tasks.find(item => item.id === next.id)!;
  assert.equal(rejected.state, 'failed');
  assert.ok(rejected.issues.some(issue => /配音待更新/.test(issue.message)));
  assert.equal((await querySpeech(service.url)).tasks.length, 2, '恢复及导出校验不会自动重试配音');
  assert.deepEqual(readdirSync(join(projectDirectory, 'exports')), files);
});
