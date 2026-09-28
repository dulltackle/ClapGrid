import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openBusiness } from '../src/business/index.js';

const success = () => new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n');
async function settle(business: ReturnType<typeof openBusiness>) {
  for (let i = 0; i < 200 && business.getSpeechStatus().locked; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(business.getSpeechStatus().locked, false, '配音任务应结束并解锁');
}

test('成功后只保留最近三个音频，清理不丢失请求去重记录，失败不清理', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-retention-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let failed = false; let calls = 0;
  const runtime = { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => { calls++; return failed ? new Response('', { status: 402 }) : success(); }) as typeof fetch };
  let business = openBusiness(directory, runtime); t.after(() => business.close());
  const segment = business.addSegment('第一条').segments[0]!;
  const requests = []; const paths = [];
  for (const text of ['第一条', '第二条', '第三条', '第四条']) {
    business.editSegment(segment.id, text);
    const request = { requestId: randomUUID(), segmentId: segment.id }; requests.push(request);
    const task = business.submitSpeech(request); await settle(business);
    paths.push(business.getSpeechAudio(task.id));
  }
  assert.deepEqual(business.getSpeechStatus().audio.map(audio => audio.input.text), ['第二条', '第三条', '第四条']);
  assert.equal(business.getSpeechStatus().tasks.at(-1)?.input.text, '第四条');
  assert.equal(existsSync(paths[0]!), false);
  assert.equal(readdirSync(business.getSnapshot().storage.mediaDirectory).filter(name => name.endsWith('.mp3')).length, 3);
  const before = business.getSpeechStatus().audio;
  failed = true;
  business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await settle(business);
  assert.deepEqual(business.getSpeechStatus().audio, before);
  assert.equal(business.getSpeechStatus().tasks.at(-1)?.state, 'failed');
  business.close(); business = openBusiness(directory, runtime);
  assert.deepEqual(business.getSpeechStatus().audio, before);
  const old = business.submitSpeech(requests[0]!);
  assert.equal(old.state, 'succeeded');
  assert.throws(() => business.getSpeechAudio(old.id), /完整音频不存在/);
  assert.equal(calls, 5);
});

test('有效配音供导出读取，改回恢复旧音频，重新生成成功替换当前配音', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-current-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const business = openBusiness(directory, { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => { calls++; return success(); }) as typeof fetch });
  t.after(() => business.close());
  const segment = business.addSegment('原文').segments[0]!;
  assert.throws(() => business.getCurrentSpeechAudio(segment.id), /配音缺失/);
  const first = business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
  assert.throws(() => business.getCurrentSpeechAudio(segment.id), /配音进行中/);
  await settle(business);
  const original = business.getSpeechAudio(first.id);
  assert.equal(business.getCurrentSpeechAudio(segment.id), original);
  business.editSegment(segment.id, '新文');
  assert.throws(() => business.getCurrentSpeechAudio(segment.id), /配音待更新/);
  assert.equal(business.getSpeechAudio(first.id), original);
  business.editSegment(segment.id, '原文');
  assert.equal(business.getCurrentSpeechAudio(segment.id), original);
  assert.equal(calls, 1);
  const second = business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await settle(business);
  assert.equal(business.getCurrentSpeechAudio(segment.id), business.getSpeechAudio(second.id));
});

test('视频关联与项目重排不影响有效性，清理音频不删除导入视频', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-speech-video-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'video.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-c:v', 'libx264', source]);
  const business = openBusiness(join(directory, 'project'), { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => success()) as typeof fetch });
  t.after(() => business.close());
  const first = business.addSegment('文案').segments[0]!;
  const second = business.addSegment('另一片段').segments[1]!;
  business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }); await settle(business);
  const token = business.acquire('user');
  const video = await business.importVideo(token, { sourcePath: source });
  const result = await business.modifyBatch(token, { changes: [
    { kind: 'video', expected: first, assetId: video.id, start: 0.5 },
    { kind: 'reorder', expectedIds: [first.id, second.id], ids: [second.id, first.id] },
  ] });
  business.release(token);
  assert.equal(result.summary.applied, 2);
  assert.equal(business.getSpeechStatus().audio[0]?.valid, true);
  for (let i = 0; i < 3; i++) { business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }); await settle(business); }
  assert.equal(business.getSpeechStatus().audio.length, 3);
  for (const kind of ['source', 'preview', 'thumbnail'] as const) assert.ok(existsSync(business.getMedia(video.id, kind)));
});

test('旧服务迟到结果不能恢复重开后已删除的片段或写入音频', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-speech-late-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let finish!: (response: Response) => void;
  const runtime = { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch };
  let business = openBusiness(directory, runtime); t.after(() => business.close());
  const segment = business.addSegment('待删除').segments[0]!;
  const request = { requestId: randomUUID(), segmentId: segment.id };
  business.submitSpeech(request);
  await new Promise(resolve => setImmediate(resolve));
  business.close(); business = openBusiness(directory, runtime);
  const token = business.acquire('user');
  await business.modifyBatch(token, { changes: [{ kind: 'delete', expected: segment }] }); business.release(token);
  finish(success()); await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(business.getSnapshot().segments, []);
  assert.deepEqual(business.getSpeechStatus().audio, []);
  assert.equal(business.submitSpeech(request).state, 'unknown');
  assert.equal(readdirSync(business.getSnapshot().storage.mediaDirectory).filter(name => name.endsWith('.mp3')).length, 0);
});

test('旧项目按成功时间清理，优先保留当前有效配音而非仅保留最新三个', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-speech-legacy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => success()) as typeof fetch };
  let business = openBusiness(directory, runtime); t.after(() => business.close());
  const segment = business.addSegment('有效旧文案').segments[0]!;
  const task = business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await settle(business);
  const originalPath = business.getSpeechAudio(task.id);
  const { database, mediaDirectory } = business.getSnapshot().storage;
  const template = business.getSpeechStatus().tasks[0]!;
  business.close();
  // 构造升级前的持久化项目：四条成功音频，提交顺序与成功顺序不同。
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
  business = openBusiness(directory, runtime);
  assert.deepEqual(business.getSpeechStatus().audio.map(audio => audio.input.text), ['有效旧文案', '次新旧音频', '最新旧音频']);
  assert.equal(business.getCurrentSpeechAudio(segment.id), originalPath);
  assert.equal(readdirSync(mediaDirectory).filter(name => name.endsWith('.mp3')).length, 3);
});
