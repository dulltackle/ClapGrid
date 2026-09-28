import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBusiness } from '../src/business/index.js';
import type { ExportTask } from '../src/shared/contracts.js';

async function finished(business: ReturnType<typeof openBusiness>, id: string): Promise<ExportTask> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const task = business.getExportTasks().tasks.find(task => task.id === id)!;
    if (['failed', 'cancelled', 'succeeded'].includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('导出任务未结束');
}

test('先受理再汇总空项目及设置问题，重复请求共享任务且校验期间锁定', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-task-'));
  const business = openBusiness(directory);
  t.after(async () => { await business.close(); rmSync(directory, { recursive: true, force: true }); });
  const task = business.submitExport();
  assert.equal(task.state, 'accepted');
  assert.equal(business.submitExport().id, task.id);
  assert.equal(business.getExportTasks().locked, true);
  assert.throws(() => business.acquire('user'), /导出/);
  assert.throws(() => business.addSegment('不能新增'), /导出/);
  assert.throws(() => business.setVoice({ speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }), /导出|修改/);
  const result = await finished(business, task.id);
  assert.equal(result.state, 'failed');
  assert.match(result.issues.map(issue => issue.message).join('；'), /空项目.*字幕字体.*字幕字号/);
  assert.equal(business.getExportTasks().locked, false);
  assert.equal(business.getSpeechStatus().tasks.length, 0);
});

test('汇总逐片段缺失视频、配音与修改占用，不自动配音或跳过片段', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-invalid-'));
  const business = openBusiness(directory);
  t.after(async () => { await business.close(); rmSync(directory, { recursive: true, force: true }); });
  const first = business.addSegment('甲').segments[0]!;
  const second = business.addSegment('乙').segments[1]!;
  const token = business.acquire('user');
  const task = business.submitExport();
  const result = await finished(business, task.id);
  assert.equal(result.state, 'failed');
  assert.ok(result.issues.some(issue => /用户正在编辑/.test(issue.message)));
  for (const segment of [first, second]) {
    assert.ok(result.issues.some(issue => issue.segmentId === segment.id && issue.order === segment.order && issue.field === 'video'));
    assert.ok(result.issues.some(issue => issue.segmentId === segment.id && issue.field === 'speech'));
  }
  assert.equal(business.getSpeechStatus().tasks.length, 0);
  assert.deepEqual(business.getModification(), { owner: 'user' });
  business.release(token);
});

async function ready(t: import('node:test').TestContext, options: { duration?: number; sar?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-render-'));
  const source = join(root, 'source.mp4'); const audio = join(root, 'speech.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=96x96:r=25:d=0.4', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:r=25:d=0.6', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1', '-filter_complex', `[0:v][1:v]concat=n=2:v=1:a=0,setsar=${options.sar ?? 1}[v]`, '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', source]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${options.duration ?? 0.8}`, '-ar', '24000', audio]);
  let failSpeech = false;
  const payload = readFileSync(audio).toString('base64');
  const directory = join(root, 'project');
  const business = openBusiness(directory, { key: () => 'test-key', configPath: '.env', fetch: (async () => failSpeech
    ? new Response('失败', { status: 500 })
    : new Response(`data: {"code":0,"data":"${payload}"}\n\ndata: {"code":20000000}\n\n`)) as typeof fetch });
  t.after(async () => { await business.close(); rmSync(root, { recursive: true, force: true }); });
  const token = business.acquire('codex');
  const asset = await business.importVideo(token, { sourcePath: source });
  const first = business.addSegment('第一句字幕，整句随配音显示。', token).segments[0]!;
  const second = business.addSegment('第二句字幕', token).segments[1]!;
  await business.modifyBatch(token, { changes: [
    { kind: 'video', expected: first, assetId: asset.id, start: 0.6 },
    { kind: 'video', expected: second, assetId: asset.id, start: 0 },
  ] });
  const expected = business.getSnapshot().exportSettings;
  await business.setExportSettings(token, { expected, settings: { ...expected, fps: 25, fontFamily: 'Noto Sans CJK SC', fontSize: 48 } });
  business.release(token);
  const waitSpeech = async () => {
    for (let i = 0; i < 500 && business.getSpeechStatus().locked; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(business.getSpeechStatus().locked, false);
  };
  for (const segment of [first, second]) { business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await waitSpeech(); }
  return { root, directory, business, asset, first, second, waitSpeech, failNextSpeech: () => { failSpeech = true; } };
}

function probe(path: string) { return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' })); }
function frame(path: string, seconds: number) { return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', path, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 8 * 1024 * 1024 }); }
function pixel(data: Buffer, x: number, y: number) { return [...data.subarray((y * 1920 + x) * 3, (y * 1920 + x) * 3 + 3)]; }

test('真实全片按项目顺序导出：起点、冻结、留边、烧录字幕与 MP4 参数，失败的最新配音不妨碍有效旧配音', async t => {
  const { business, first, second, failNextSpeech, waitSpeech, directory, asset } = await ready(t);
  const table = business.connectTable(); business.selectSegments(table, [second.id]);
  failNextSpeech(); business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }); await waitSpeech();
  const accepted = business.submitExport();
  await rendering(business, accepted.id);
  writeFileSync(business.getMedia(asset.id, 'source'), '原视频已在外部修改');
  writeFileSync(business.getCurrentSpeechAudio(first.id), '原配音已在外部修改');
  const result = await finished(business, accepted.id);
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  assert.equal(result.total, 2); assert.equal(result.completed, 2);
  assert.deepEqual(result.warnings.map(issue => issue.segmentId), [first.id]);
  const path = result.output!.path;
  assert.equal(path.startsWith(join(directory, 'exports')), true);
  const media = probe(path); const video = media.streams.find((stream: any) => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height, video.r_frame_rate], ['h264', 1920, 1080, '25/1']);
  assert.equal(media.streams.filter((stream: any) => stream.codec_type === 'audio').length, 1);
  const samples = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', '-']);
  const energy = (hz: number) => {
    let sine = 0; let cosine = 0;
    for (let i = 2400; i < 24000; i++) { const value = samples.readFloatLE(i * 4); sine += value * Math.sin(2 * Math.PI * hz * i / 48000); cosine += value * Math.cos(2 * Math.PI * hz * i / 48000); }
    return sine * sine + cosine * cosine;
  };
  assert.ok(energy(440) > 100 * energy(1000), '只有配音，没有原视频的 1000 Hz 原声');

  assert.ok(Number(media.format.duration) >= 1.6 && Number(media.format.duration) < 1.8);
  const start = frame(path, 0.1); const frozen = frame(path, 0.65); const next = frame(path, 0.9);
  assert.ok(pixel(start, 960, 100)[2]! > 200, '第一片段从蓝色画面开始');
  assert.ok(pixel(frozen, 960, 100)[2]! > 200, '视频不足时蓝色末帧冻结');
  assert.ok(pixel(next, 960, 100)[0]! > 200, '第二片段紧接红色画面');
  assert.ok(pixel(start, 10, 100).every(value => value < 5), '方形视频等比缩放留边');
  let white = 0;
  for (let y = 850; y < 1070; y++) for (let x = 500; x < 1420; x++) if (pixel(start, x, y).every(value => value > 210)) white++;
  assert.ok(white > 300, '底部有烧录的白色字幕像素');
  assert.deepEqual(readdirSync(join(directory, 'exports')), [path.split('/').at(-1)]);
});

async function rendering(business: ReturnType<typeof openBusiness>, id: string) {
  for (let i = 0; i < 2000; i++) {
    const task = business.getExportTasks().tasks.find(task => task.id === id)!;
    if (task.state === 'rendering') return;
    assert.ok(!['failed', 'cancelled', 'succeeded'].includes(task.state), JSON.stringify(task));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未进入渲染');
}

test('取消真实渲染显示清理状态，停止并删除本次文件后才解锁，保留历史成片', async t => {
  const { business, directory, first } = await ready(t);
  mkdirSync(join(directory, 'exports')); writeFileSync(join(directory, 'exports', 'previous.mp4'), '已有成片');
  const task = business.submitExport();
  await rendering(business, task.id);
  assert.equal(business.submitExport().id, task.id);
  assert.throws(() => business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }), /导出/);
  assert.throws(() => business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'all' } }), /导出/);
  assert.equal(business.cancelExport(task.id).state, 'cleaning');
  assert.equal(business.getExportTasks().locked, true);
  assert.throws(() => business.acquire('codex'), /导出/);
  assert.equal((await finished(business, task.id)).state, 'cancelled');
  assert.equal(business.getExportTasks().locked, false);
  assert.deepEqual(readdirSync(join(directory, 'exports')), ['previous.mp4']);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(readdirSync(join(directory, 'exports')), ['previous.mp4'], '已停止的进程不会重新生成半成品');
  assert.equal(readFileSync(join(directory, 'exports', 'previous.mp4'), 'utf8'), '已有成片');
});

test('渲染器失败定位片段并清理半成品，已有成片保留且项目恢复编辑', async t => {
  const { business, directory, root, first } = await ready(t);
  const actualFfmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
  const shim = join(root, 'bin'); mkdirSync(shim);
  writeFileSync(join(shim, 'ffmpeg'), `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (args.some(value => value.includes('subtitles=subtitle-'))) { fs.writeFileSync(args.at(-1), '半成品'); console.error('模拟编码器运行失败'); process.exit(7); }\nconst result = require('node:child_process').spawnSync(${JSON.stringify(actualFfmpeg)}, args, {stdio:'inherit'}); process.exit(result.status ?? 1);\n`, { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = `${shim}:${previous}`;
  try {
    mkdirSync(join(directory, 'exports')); writeFileSync(join(directory, 'exports', 'previous.mp4'), '已有成片');
    const result = await finished(business, business.submitExport().id);
    assert.equal(result.state, 'failed'); assert.match(result.message, /模拟编码器运行失败/);
    assert.equal(result.segmentId, first.id);
    assert.equal(result.issues.at(-1)?.segmentId, first.id);
    assert.deepEqual(readdirSync(join(directory, 'exports')), ['previous.mp4']);
    const token = business.acquire('user'); business.release(token);
  } finally { process.env.PATH = previous; }
});

test('损坏视频、真实时长变化导致起点失效、待更新或损坏配音一次汇总且不产生成片', async t => {
  const { business, first, second, asset, directory, root } = await ready(t);
  const source = business.getMedia(asset.id, 'source');
  const shorter = join(root, 'short.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=96x96:d=0.4', '-c:v', 'libx264', shorter]);
  writeFileSync(source, readFileSync(shorter));
  business.editSegment(first.id, '文案已修改，配音待更新');
  writeFileSync(business.getCurrentSpeechAudio(second.id), '损坏配音');
  let result = await finished(business, business.submitExport().id);
  assert.equal(result.state, 'failed');
  assert.ok(result.issues.some(issue => issue.segmentId === first.id && issue.field === 'start'));
  assert.ok(result.issues.some(issue => issue.segmentId === first.id && issue.message === '配音待更新'));
  assert.ok(result.issues.some(issue => issue.segmentId === second.id && issue.message.includes('不可解码')));
  assert.equal(result.completed, 0);
  writeFileSync(source, '不是视频');
  result = await finished(business, business.submitExport().id);
  assert.equal(result.issues.filter(issue => issue.field === 'video').length, 2);
  assert.equal(business.getSpeechStatus().tasks.length, 2);
  assert.deepEqual(readdirSync(join(directory, 'exports')), []);
});

test('再次导出使用新内容和设置，生成唯一文件且保留原成片，长文案多行烧录不阻止导出', async t => {
  const { business, first, waitSpeech } = await ready(t);
  const original = await finished(business, business.submitExport().id);
  assert.equal(original.state, 'succeeded');
  const before = readFileSync(original.output!.path);
  const long = '这是一句完整显示的长文案，用于验证字幕能够自动换行而不被拆成多个片段。'.repeat(5);
  business.editSegment(first.id, long);
  business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }); await waitSpeech();
  const token = business.acquire('user'); const expected = business.getSnapshot().exportSettings;
  await business.setExportSettings(token, { expected, settings: { ...expected, codec: 'mpeg4', fps: 30, fontSize: 64 } }); business.release(token);
  const result = await finished(business, business.submitExport().id);
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  assert.equal(result.total, 2); assert.notEqual(result.output!.path, original.output!.path);
  assert.deepEqual(readFileSync(original.output!.path), before);
  assert.ok(existsSync(result.output!.path));
  const media = probe(result.output!.path); const video = media.streams.find((stream: any) => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.r_frame_rate], ['mpeg4', '30/1']);
  assert.ok(result.warnings.every(issue => issue.field === 'video'));
  const image = frame(result.output!.path, 0.1);
  const bands: number[] = [];
  for (let y = 300; y < 1030; y++) {
    let whites = 0;
    for (let x = 80; x < 1840; x++) if (pixel(image, x, y).every(value => value > 220)) whites++;
    if (whites > 15 && (bands.length === 0 || y - bands.at(-1)! > 65)) bands.push(y);
  }
  assert.ok(bands.length >= 3, `长文案至少分三行烧录，实际行带 ${bands}`);
});

test('配音刚受理及生成时拒绝导出且不创建任务，结束后恢复前置校验', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-speech-lock-'));
  let finish!: (response: Response) => void;
  const business = openBusiness(directory, { configPath: '.env', key: () => 'key', fetch: (async () => new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch });
  t.after(async () => { await business.close(); rmSync(directory, { recursive: true, force: true }); });
  const segment = business.addSegment('配音尚未完成').segments[0]!;
  business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
  assert.equal(business.getSpeechStatus().tasks[0]!.state, 'accepted');
  assert.throws(() => business.submitExport(), /配音任务尚未结束/);
  assert.deepEqual(business.getExportTasks(), { locked: false, tasks: [] });
  assert.equal(existsSync(join(directory, 'exports')), false);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(business.getSpeechStatus().tasks[0]!.state, 'running');
  assert.throws(() => business.submitExport(), /配音任务尚未结束/);
  assert.deepEqual(business.getExportTasks(), { locked: false, tasks: [] });
  assert.equal(existsSync(join(directory, 'exports')), false);
  assert.equal(business.getSpeechStatus().tasks.length, 1);
  assert.throws(() => business.acquire('user'), /配音/);
  finish(new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n'));
  for (let i = 0; i < 200 && business.getSpeechStatus().locked; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const token = business.acquire('user'); business.release(token);
  const result = await finished(business, business.submitExport().id);
  assert.equal(result.state, 'failed');
  assert.ok(result.issues.some(issue => issue.field === 'video'));
  assert.ok(result.issues.some(issue => issue.field === 'settings'));
  assert.ok(result.issues.every(issue => !/配音任务尚未结束/.test(issue.message)));

});

test('配音时长不是视频帧整倍数时，拼接处不插入静音间隔', async t => {
  const { business } = await ready(t, { duration: 0.83 });
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded');
  const samples = execFileSync('ffmpeg', ['-v', 'error', '-i', task.output!.path, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', '-']);
  let square = 0;
  for (let i = 40032; i < 40224; i++) square += samples.readFloatLE(i * 4) ** 2;
  assert.ok(Math.sqrt(square / 192) > 0.05, '0.834–0.838 秒处应已开始第二段配音，不能存在按帧补齐的静音');
  const packets = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pts,duration', '-of', 'json', task.output!.path], { encoding: 'utf8' })).packets;
  assert.ok(packets.every((packet: { duration: number }) => packet.duration <= 1024), 'AAC 包不能因片段取整增加播放时间间隔');
  for (let i = 1; i < packets.length; i++) assert.equal(packets[i].pts - packets[i - 1].pts, 1024);

});

test('非方形像素视频按显示宽高比缩放，不能压成方形', async t => {
  const { business } = await ready(t, { sar: 2 });
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded');
  const image = frame(task.output!.path, 0.1);
  assert.ok(pixel(image, 100, 540)[2]! > 200, '2:1 显示比例应铺满宽度');
  assert.ok(pixel(image, 960, 10).every(value => value < 5), '上下留边保持显示比例');
});

test('合法起点落在视频末帧持续区间内时，使用末帧冻结而不是丢失画面', async t => {
  const { business, asset } = await ready(t);
  const token = business.acquire('user');
  await business.modifyBatch(token, { changes: [{ kind: 'video', expected: business.getSnapshot().segments[0]!, assetId: asset.id, start: 0.99 }] }); business.release(token);
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded', JSON.stringify(task));
  assert.ok(pixel(frame(task.output!.path, 0.1), 960, 100)[2]! > 200);
});

test('成片提供含字幕和声音的浏览器兼容预览，MP4 原文件仍独立保留', async t => {
  const { business } = await ready(t);
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded');
  assert.ok(task.output!.previewUrl);
  const preview = business.getExportFile(task.id, 'preview');
  const media = probe(preview);
  assert.equal(media.streams.find((stream: any) => stream.codec_type === 'video').codec_name, 'vp8');
  assert.equal(media.streams.find((stream: any) => stream.codec_type === 'audio').codec_name, 'vorbis');
  assert.equal(business.getExportFile(task.id), task.output!.path);
});
