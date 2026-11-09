import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBusinessMcp } from '../src/mcp/server.js';
import { beginEdit, queryStatus, queryVisualContext } from '../src/shared/client.js';
import type { ContactSheet, ExportTasksStatus } from '../src/shared/contracts.js';
import { fullPage, pageProject } from './helpers/page-project.js';
import { test, type ResourceFixtures } from './helpers/resource-test.js';

async function reviewTools(url: string, openConnection: ResourceFixtures['openConnection']) {
  const server = openConnection(() => createBusinessMcp(url));
  const client = openConnection(() => new Client({ name: '接触印样验收', version: '1' }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const sample = (taskId: string, sampling: Record<string, unknown>) => client.callTool({ name: 'clapgrid_contact_sheet', arguments: { taskId, sampling } });
  const tasks = async (name: string) => {
    const response = await client.callTool({ name, arguments: {} });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return (response.structuredContent as ExportTasksStatus).tasks;
  };
  return { sample, tasks };
}

async function pixel(execBytes: ResourceFixtures['execBytes'], path: string, x: number, y: number) {
  return [...await execBytes('ffmpeg', ['-v', 'error', '-i', path, '-vf', `crop=1:1:${x}:${y}`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])];
}

test('当前片段合成预览的接触印样保留页面、素材和字幕，取帧与表格编辑互不占用', async ({ createDirectory, execBytes, execText, startService, openConnection }) => {
  const p = await pageProject({ createDirectory, execBytes, startService }, 1, true);
  const image = join(p.root, 'blue.png');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=32x32', '-frames:v', '1', image]);
  const { asset } = await p.post('/api/codex/import-material', { sourcePath: image });
  const page = await p.importPage("window.render=()=>{document.body.style.background='red'};window.READY=true");
  await p.save([
    fullPage(page, p.duration),
    { assetId: asset.id, role: 'overlay', from: 0, to: p.duration, start: 0, x: 0.5, y: 0.1, width: 0.2, height: 0.2, z: 1 },
  ], [asset.id]);
  const preview = await p.task();
  expect(preview).toMatchObject({ state: 'succeeded', current: true });
  const review = await reviewTools(p.service.url, openConnection);
  const [previewTask] = await review.tasks('clapgrid_visual_previews');
  expect(previewTask).toMatchObject({
    id: preview.id, current: true, segmentBoundaries: [{ order: 1, segmentId: p.segmentId, start: 0, duration: 1, visualStart: 0 }],
  });
  expect(previewTask).not.toHaveProperty('technicalChecks');

  const before = await queryStatus(p.service.url);
  const edit = await beginEdit(p.service.url);
  openConnection(() => edit);
  const pending = review.sample(preview.id, { times: [0.999, 0.2] });
  expect(await queryStatus(p.service.url)).toMatchObject({ taskLocked: false, modification: { owner: 'user' } });
  const result = await pending;
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  await edit.close();
  const output = result.structuredContent as ContactSheet;
  expect(output).toMatchObject({
    frames: [
      { time: 0.2, order: 1, segmentId: p.segmentId, segmentTime: 0.2, label: '#1 · 0.200s' },
      { time: 0.999, order: 1, segmentId: p.segmentId, segmentTime: 0.999, label: '#1 · 0.999s' },
    ],
  });
  expect(dirname(dirname(output.path))).toBe(join(p.options.projectDirectory, '.cache', 'review-frames'));
  async function dimensions(path: string) {
    const data = JSON.parse(await execText('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path], { encoding: 'utf8' }));
    return data.streams[0];
  }
  expect(await dimensions(output.path)).toMatchObject({ codec_name: 'png', width: 1920, height: 252 });
  for (const crop of ['1280:44:0:0', '320:28:0:224']) {
    const strip = await execBytes('ffmpeg', ['-v', 'error', '-i', output.path, '-vf', `crop=${crop}`, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
    expect(strip.some(value => value > 200)).toBe(true);
  }
  for (const frame of output.frames) {
    expect(dirname(frame.path)).toBe(dirname(output.path));
    expect(await dimensions(frame.path)).toMatchObject({ codec_name: 'png', width: 1920, height: 1080 });
  }
  const frame = output.frames[0]!.path;
  expect((await pixel(execBytes, frame, 100, 100))[0]).toBeGreaterThan(220);
  expect((await pixel(execBytes, frame, 1150, 200))[2]).toBeGreaterThan(220);
  const caption = await pixel(execBytes, frame, 90, 950);
  expect(caption[0]).toBeGreaterThan(220);
  expect(caption[2]).toBeGreaterThan(220);
  expect((await queryStatus(p.service.url)).snapshot).toEqual(before.snapshot);
}, 60000);

test('成片接触印样按导出时的片段边界排列，旧成片仍可按全片时间取帧', async ({ createDirectory, execBytes, startService, openConnection }) => {
  const p = await pageProject({ createDirectory, execBytes, startService }, 1.03, true);
  const red = await p.importPage("window.render=()=>{document.body.style.background='red'};window.READY=true");
  await p.save([fullPage(red, p.duration)]);
  const green = await p.importPage("window.render=t=>{document.body.style.background=t>=0.12&&t<0.16?'blue':'lime'};window.READY=true");
  const added = await p.post('/api/codex/modify', { changes: [{ kind: 'add', text: '第二个片段' }] });
  const second = added.status.snapshot.segments[1];
  await p.post('/api/codex/modify', { changes: [{ kind: 'materials', expected: second, assetIds: [] }] });
  await p.post('/api/speech/submit', { requestId: randomUUID(), segmentId: second.id });
  await expect.poll(async () => (await queryStatus(p.service.url)).taskLocked).toBe(false);
  const context = await queryVisualContext(p.service.url, second.id);
  const composed = await p.post('/api/codex/modify', { changes: [{ kind: 'composition', expected: context.segment, plan: { duration: context.duration, layers: [fullPage(green, context.duration)] } }] });
  expect(composed.summary.applied, JSON.stringify(composed)).toBe(1);
  const exported = await p.task('export');
  expect(exported, JSON.stringify(exported)).toMatchObject({ state: 'succeeded' });

  const review = await reviewTools(p.service.url, openConnection);
  const [task] = await review.tasks('clapgrid_export_status');
  expect(task?.technicalChecks).toEqual(exported.technicalChecks);
  expect(task?.technicalChecks).toMatchObject({ loudnessBefore: { rangeLu: expect.any(Number) }, loudnessAfter: { rangeLu: expect.any(Number) }, blackIntervals: [] });
  expect(task).toMatchObject({ id: exported.id, segmentBoundaries: [
    { order: 1, segmentId: p.segmentId, start: 0, duration: 1.03, visualStart: 0 },
    { order: 2, segmentId: second.id, start: 1.03, duration: 1.03, visualStart: 1.04 },
  ] });
  expect(Date.parse(task!.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(task!.createdAt));
  await p.post('/api/codex/modify', { changes: [{ kind: 'delete', expected: composed.status.snapshot.segments[1] }] });
  expect((await queryStatus(p.service.url)).snapshot.segments.map(segment => segment.id)).toEqual([p.segmentId]);
  const result = await review.sample(exported.id, { from: 0.25, to: 1.8, interval: 0.25 });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const sheet = result.structuredContent as ContactSheet;
  expect(sheet.heading).toContain(`成片 · 导出任务 ${exported.id} · 导出时间 ${task!.finishedAt}`);
  expect(sheet.frames.map(frame => frame.time)).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  expect(sheet.frames[2]).toMatchObject({ order: 1, segmentId: p.segmentId, segmentTime: 0.75, label: '#1 · 0.750s · 0.750s' });
  expect(sheet.frames[4]).toMatchObject({ order: 2, segmentId: second.id, segmentTime: 0.21, label: '#2 · 0.210s · 1.250s' });
  expect((await pixel(execBytes, sheet.frames[2]!.path, 100, 100))[0]).toBeGreaterThan(220);
  expect((await pixel(execBytes, sheet.frames[4]!.path, 100, 100))[1]).toBeGreaterThan(220);
  expect((await pixel(execBytes, sheet.path, 2 * 320 + 100, 100))[0]).toBeGreaterThan(220);
  expect((await pixel(execBytes, sheet.path, 4 * 320 + 100, 100))[1]).toBeGreaterThan(220);
  expect((await pixel(execBytes, sheet.path, 100, 308))[1]).toBeGreaterThan(220);

  // 配音在 1.030 秒相接，25 fps 的画面在 1.040 秒切换。
  const cut = await review.sample(exported.id, { times: [1.031, 1.04, 1.16] });
  expect(cut.isError, JSON.stringify(cut)).not.toBe(true);
  const cutSheet = cut.structuredContent as ContactSheet;
  expect(cutSheet.frames.map(frame => frame.segmentId)).toEqual([p.segmentId, second.id, second.id]);
  expect((await pixel(execBytes, cutSheet.frames[0]!.path, 100, 100))[0]).toBeGreaterThan(220);
  expect((await pixel(execBytes, cutSheet.frames[1]!.path, 100, 100))[1]).toBeGreaterThan(220);
  expect((await pixel(execBytes, cutSheet.frames[2]!.path, 100, 100))[2]).toBeGreaterThan(220);
  expect(dirname(cutSheet.path)).not.toBe(dirname(sheet.path));

  const database = (await queryStatus(p.service.url)).snapshot.storage.database;
  await p.service.close();
  // 构造上线前已经成功的导出记录，产物仍是上述真实成片。
  const legacy = new DatabaseSync(database);
  try { legacy.prepare("UPDATE export_tasks SET value = json_remove(value, '$.segmentBoundaries', '$.finishedAt', '$.technicalChecks') WHERE id = ?").run(exported.id); }
  finally { legacy.close(); }
  const reopened = await startService(p.options);
  const oldReview = await reviewTools(reopened.url, openConnection);
  const [oldTask] = await oldReview.tasks('clapgrid_export_status');
  expect(oldTask).toMatchObject({ id: exported.id, state: 'succeeded', output: exported.output });
  expect(oldTask).not.toHaveProperty('technicalChecks');
  const old = await oldReview.sample(exported.id, { times: [1.2] });
  expect(old.isError, JSON.stringify(old)).not.toBe(true);
  const oldSheet = old.structuredContent as ContactSheet;
  expect(oldSheet.heading).toContain(`${exported.id} · 受理时间 ${exported.createdAt} · 片段未标注`);
  expect(oldSheet.frames[0]).toMatchObject({ time: 1.2, order: null, segmentId: null, segmentTime: null, label: '1.200s' });
}, 60000);

test('接触印样拒绝非法采样、过期预览和不可用产物，无风格预览仍可取帧', async ({ createDirectory, execBytes, startService, openConnection }) => {
  const p = await pageProject({ createDirectory, execBytes, startService });
  const page = await p.importPage("window.render=()=>{document.body.style.background='red'};window.READY=true");
  await p.save([fullPage(page, p.duration)]);
  const preview = await p.task();
  expect(preview).toMatchObject({ state: 'succeeded', preview: { subtitleIssue: '未设置项目风格，预览不含字幕' } });
  const review = await reviewTools(p.service.url, openConnection);
  async function rejects(taskId: string, sampling: Record<string, unknown>, reason: RegExp) {
    const result = await review.sample(taskId, sampling);
    expect(result.isError, JSON.stringify(result)).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(reason);
  }
  const sampling = { times: [0.2] };
  await rejects(randomUUID(), sampling, /任务不存在/);
  await rejects(preview.id, { times: Array(61).fill(0) }, /最多抽取 60 帧/);
  await rejects(preview.id, { from: 0, to: 0.9, interval: 0.01 }, /最多抽取 60 帧/);
  await rejects(preview.id, { times: [p.duration] }, /视频区间/);
  await rejects(preview.id, { from: 0.5, to: 0.3, interval: 0.1 }, /起点不大于终点/);
  await rejects(preview.id, { from: 0, to: 0.3, interval: 0 }, /interval/);

  const cache = join(p.options.projectDirectory, '.cache', 'review-frames');
  const outside = join(p.root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, cache);
  await rejects(preview.id, sampling, /缓存目录不能是符号链接/);
  expect(readdirSync(outside)).toEqual([]);
  rmSync(cache);
  const result = await review.sample(preview.id, sampling);
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect((await pixel(execBytes, (result.structuredContent as ContactSheet).frames[0]!.path, 90, 950))[2]).toBeLessThan(30);

  rmSync(preview.output!.path);
  await rejects(preview.id, sampling, /产物文件已不存在/);
  const broken = await p.importPage("window.render=()=>{throw new Error('故障')};window.READY=true");
  await p.save([fullPage(broken, p.duration)]);
  await rejects(preview.id, sampling, /请重新制作预览/);
  const failed = await p.task();
  expect(failed.state).toBe('failed');
  await rejects(failed.id, sampling, /任务未成功/);
}, 60000);
