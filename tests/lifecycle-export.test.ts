import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openBusiness } from '../src/business/index.js';
import { queryStatus, queryExports, submitExport, modifyBatch } from '../src/shared/client.js';

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
  const directory = join(root, 'project'); const video = join(root, 'video.mp4'); const audio = join(root, 'voice.mp3');
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
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as import('node:net').AddressInfo).port; await new Promise<void>(resolve => socket.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const children: ReturnType<typeof spawn>[] = [];
  const residualMedia: number[] = [];
  const start = async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/service/main.ts', '--project', directory, '--port', String(port), '--dev'], { stdio: 'ignore' });
    children.push(child);
    const status = await until(() => queryStatus(url), value => value.pid === child.pid);
    return { child, status };
  };
  t.after(async () => {
    for (const pid of residualMedia) { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出。 */ } }
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    rmSync(root, { recursive: true, force: true });
  });
  const first = await start();
  const accepted = await submitExport(url);
  assert.equal((await submitExport(url)).id, accepted.id);
  assert.equal((await queryStatus(url)).taskLocked, true);
  const complete = await until(() => queryExports(url), value => !value.locked);
  const output = complete.tasks.find(task => task.id === accepted.id)!;
  assert.equal(output.state, 'succeeded', JSON.stringify(output));
  const original = readFileSync(output.output!.path);
  const next = await submitExport(url);
  await until(() => queryExports(url), value => value.tasks.some(task => task.id === next.id && task.state === 'rendering'));
  // 从操作系统观察本次真实 FFmpeg，重开解锁时它必须已停止。
  const descendants = (pid: number): number[] => {
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
    return children.flatMap(child => [child, ...descendants(child)]);
  };
  const mediaPids = await until(async () => descendants(first.child.pid!).filter(pid => {
    try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'ffmpeg'; } catch { return false; }
  }), value => value.length > 0);
  first.child.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await queryStatus(url)).instanceId, first.status.instanceId);
  assert.equal((await queryStatus(url)).taskLocked, true);
  first.child.kill('SIGKILL'); await once(first.child, 'exit');
  const second = await start();
  assert.equal(second.status.snapshot.project.id, first.status.snapshot.project.id);
  const recovered = await until(() => queryExports(url), value => !value.locked);
  for (const pid of mediaPids) {
    let alive = false;
    try { alive = !readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.startsWith('Z'); } catch { /* 已回收。 */ }
    assert.equal(alive, false, `重开解锁时旧媒体进程 ${pid} 仍存活`);
  }
  assert.equal(recovered.tasks.find(task => task.id === next.id)!.state, 'interrupted');
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
  const active = await until(async () => descendants(second.child.pid!).filter(pid => {
    try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'ffmpeg'; } catch { return false; }
  }), value => value.length > 0);
  residualMedia.push(...active);
  for (const pid of active) process.kill(pid, 'SIGSTOP');
  const guardianPid = Number(readFileSync(join(directory, 'media-active.json'), 'utf8').match(/"guardianPid":(\d+)/)![1]);
  process.kill(guardianPid, 'SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await queryStatus(url)).taskLocked, true);
  assert.equal(existsSync(join(directory, 'exports', `.work-${guarded.id}`)), true);
  second.child.kill('SIGKILL'); await once(second.child, 'exit');
  const refused = spawn(process.execPath, ['--import', 'tsx', 'src/service/main.ts', '--project', directory, '--port', String(port), '--dev'], { stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(refused);
  let error = ''; refused.stderr!.on('data', chunk => { error += chunk.toString(); });
  const [code] = await once(refused, 'exit');
  assert.equal(code, 1);
  assert.match(error, /尚未确认子进程终止/);
  assert.equal(existsSync(join(directory, 'exports', `.work-${guarded.id}`)), true);
  assert.deepEqual(readFileSync(output.output!.path), original);
});
