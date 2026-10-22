import { test } from './helpers/resource-test.js';
import { expect, vi } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const success = () => new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n');

test('成功后只保留最近三个音频，清理不丢失请求去重记录，失败不清理', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-retention-'));
  let failed = false; let calls = 0;
  const runtime = { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => { calls++; return failed ? new Response('', { status: 402 }) : success(); }) as typeof fetch };
  let business = openBusiness(directory, runtime); const segment = business.addSegment('第一条').segments[0]!;
  const requests = []; const paths = [];
  for (const text of ['第一条', '第二条', '第三条', '第四条']) {
    business.editSegment(segment.id, text);
    const request = { requestId: randomUUID(), segmentId: segment.id }; requests.push(request);
    const task = business.submitSpeech(request); await expect.poll(() => business.getSpeechStatus().locked).toBe(false);
    paths.push(business.getSpeechAudio(task.id));
  }
  assert.deepEqual(business.getSpeechStatus().audio.map(audio => audio.input.text), ['第二条', '第三条', '第四条']);
  assert.equal(business.getSpeechStatus().tasks.at(-1)?.input.text, '第四条');
  assert.equal(existsSync(paths[0]!), false);
  assert.equal(readdirSync(business.getSnapshot().storage.mediaDirectory).filter(name => name.endsWith('.mp3')).length, 3);
  const before = business.getSpeechStatus().audio;
  failed = true;
  business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await expect.poll(() => business.getSpeechStatus().locked).toBe(false);
  assert.deepEqual(business.getSpeechStatus().audio, before);
  assert.equal(business.getSpeechStatus().tasks.at(-1)?.state, 'failed');
  await business.close(); business = openBusiness(directory, runtime); assert.deepEqual(business.getSpeechStatus().audio, before);
  const old = business.submitSpeech(requests[0]!);
  assert.equal(old.state, 'succeeded');
  assert.throws(() => business.getSpeechAudio(old.id), /完整音频不存在/);
  assert.equal(calls, 5);
});

test('有效配音供导出读取，改回恢复旧音频，重新生成成功替换当前配音', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-current-'));
  let calls = 0;
  const business = openBusiness(directory, { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => { calls++; return success(); }) as typeof fetch });

  const segment = business.addSegment('原文').segments[0]!;
  assert.throws(() => business.getCurrentSpeechAudio(segment.id), /配音缺失/);
  const first = business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
  assert.throws(() => business.getCurrentSpeechAudio(segment.id), /配音进行中/);
  await expect.poll(() => business.getSpeechStatus().locked).toBe(false);
  const original = business.getSpeechAudio(first.id);
  assert.equal(business.getCurrentSpeechAudio(segment.id), original);
  business.editSegment(segment.id, '新文');
  assert.throws(() => business.getCurrentSpeechAudio(segment.id), /配音待更新/);
  assert.equal(business.getSpeechAudio(first.id), original);
  business.editSegment(segment.id, '原文');
  assert.equal(business.getCurrentSpeechAudio(segment.id), original);
  assert.equal(calls, 1);
  const second = business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await expect.poll(() => business.getSpeechStatus().locked).toBe(false);
  assert.equal(business.getCurrentSpeechAudio(segment.id), business.getSpeechAudio(second.id));
});

test('视频关联与项目重排不影响有效性，清理音频不删除导入视频', async ({ createDirectory, execBytes, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-speech-video-'));
  const source = join(directory, 'video.mp4');
  (await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-c:v', 'libx264', source]));
  const business = openBusiness(join(directory, 'project'), { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => success()) as typeof fetch });

  const first = business.addSegment('文案').segments[0]!;
  const second = business.addSegment('另一片段').segments[1]!;
  business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }); await expect.poll(() => business.getSpeechStatus().locked).toBe(false);
  const token = business.acquire('user');
  const video = await business.importVideo(token, { sourcePath: source });
  const result = await business.modifyBatch(token, { changes: [
    { kind: 'video', expected: first, assetId: video.id, start: 0.5 },
    { kind: 'reorder', expectedIds: [first.id, second.id], ids: [second.id, first.id] },
  ] });
  business.release(token);
  assert.equal(result.summary.applied, 2);
  assert.equal(business.getSpeechStatus().audio[0]?.valid, true);
  for (let i = 0; i < 3; i++) { business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }); await expect.poll(() => business.getSpeechStatus().locked).toBe(false); }
  assert.equal(business.getSpeechStatus().audio.length, 3);
  for (const kind of ['source', 'preview', 'thumbnail'] as const) assert.ok(existsSync(business.getMedia(video.id, kind)));
});

test('关闭等待供应商迟到结果且不写音频，重开后仍可删除片段', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-speech-late-'));
  let finish!: (response: Response) => void;
  let cancelled!: () => void;
  const cancellation = new Promise<void>(resolve => { cancelled = resolve; });
  const runtime = { key: () => 'key', configPath: '/tmp/.env', fetch: (async (_url, input) => new Promise<Response>(resolve => {
    finish = resolve;
    // 供应商忽略取消，直到受控成功响应才结束；关闭必须等待它但不能保存音频。
    input?.signal?.addEventListener('abort', () => cancelled(), { once: true });
  })) as typeof fetch };
  let business = openBusiness(directory, runtime); const segment = business.addSegment('待删除').segments[0]!;
  const request = { requestId: randomUUID(), segmentId: segment.id };
  business.submitSpeech(request);
  await new Promise(resolve => setImmediate(resolve));
  const closing = business.close();
  await cancellation;
  assert.equal(business.getSpeechStatus().locked, true);
  finish(success()); await closing; business = openBusiness(directory, runtime); const token = business.acquire('user');
  await business.modifyBatch(token, { changes: [{ kind: 'delete', expected: segment }] }); business.release(token);
  assert.deepEqual(business.getSnapshot().segments, []);
  assert.deepEqual(business.getSpeechStatus().audio, []);
  assert.equal(business.submitSpeech(request).state, 'unknown');
  assert.equal(readdirSync(business.getSnapshot().storage.mediaDirectory).filter(name => name.endsWith('.mp3')).length, 0);
});

test('旧项目按成功时间清理，优先保留当前有效配音而非仅保留最新三个', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-speech-legacy-'));
  const runtime = { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => success()) as typeof fetch };
  let business = openBusiness(directory, runtime); const segment = business.addSegment('有效旧文案').segments[0]!;
  const task = business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await expect.poll(() => business.getSpeechStatus().locked).toBe(false);
  const originalPath = business.getSpeechAudio(task.id);
  const { database, mediaDirectory } = business.getSnapshot().storage;
  const template = business.getSpeechStatus().tasks[0]!;
  await business.close(); // 构造升级前的持久化项目：四条成功音频，提交顺序与成功顺序不同。
  const db = new DatabaseSync(database);
  try {
    db.prepare('UPDATE speech_tasks SET value = ? WHERE id = ?').run(JSON.stringify({ ...template, succeededAt: '2020-01-01T00:00:00.000Z' }), task.id);
    const { copyFileSync } = await import('node:fs');
    for (const [text, date] of [['最新旧音频', '2020-01-04'], ['应清理音频', '2020-01-02'], ['次新旧音频', '2020-01-03']]) {
      const id = randomUUID(); const requestId = randomUUID();
      copyFileSync(originalPath, join(mediaDirectory, `${id}.mp3`));
      db.prepare('INSERT INTO speech_tasks VALUES (?, ?, ?)').run(id, requestId, JSON.stringify({ ...template, id, requestId, input: { ...template.input, text }, succeededAt: `${date}T00:00:00.000Z` }));
    }
  } finally { db.close(); }
  business = openBusiness(directory, runtime); assert.deepEqual(business.getSpeechStatus().audio.map(audio => audio.input.text), ['有效旧文案', '次新旧音频', '最新旧音频']);
  assert.equal(business.getCurrentSpeechAudio(segment.id), originalPath);
  assert.equal(readdirSync(mediaDirectory).filter(name => name.endsWith('.mp3')).length, 3);
});
