import { selectTestStyle } from './helpers/project-style.js';
import { test, type ResourceFixtures } from './helpers/resource-test.js';
import type { TestContext } from 'vitest';
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, truncateSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { openBusiness } from '../src/business/index.js';
import type { ExportTask } from '../src/shared/contracts.js';

type Resources = Pick<ResourceFixtures, 'createDirectory' | 'execBytes' | 'execText' | 'openBusiness' | 'openConnection'> & Pick<TestContext, 'onTestFinished'>;

async function finished(business: ReturnType<typeof openBusiness>, id: string): Promise<ExportTask> {
  let task: ExportTask | undefined;
  await expect.poll(() => {
    task = business.getExportTasks().tasks.find(task => task.id === id);
    return task?.state;
  }, { timeout: 60000, message: `导出任务 ${id} 未结束` }).toSatisfy(state => ['failed', 'cancelled', 'succeeded', 'interrupted'].includes(state));
  return task!;
}

test('先受理再汇总空项目问题，重复请求共享任务且校验期间锁定', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-export-task-'));
  const business = openBusiness(directory);
  await selectTestStyle(business);

  const task = business.submitExport();
  assert.equal(task.state, 'accepted');
  assert.equal(business.submitExport().id, task.id);
  assert.equal(business.getExportTasks().locked, true);
  assert.throws(() => business.acquire('user'), /导出/);
  assert.throws(() => business.addSegment('不能新增'), /导出/);
  assert.throws(() => business.setVoice({ speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }), /导出|修改/);
  const result = await finished(business, task.id);
  assert.equal(result.state, 'failed');
  assert.match(result.issues.map(issue => issue.message).join('；'), /空项目/);
  assert.equal(business.getExportTasks().locked, false);
  assert.equal(business.getSpeechStatus().tasks.length, 0);
});

test('汇总逐片段缺失视频和配音，不自动配音或跳过片段', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-export-invalid-'));
  const business = openBusiness(directory);
  await selectTestStyle(business);

  const first = business.addSegment('甲').segments[0]!;
  const second = business.addSegment('乙').segments[1]!;
  const task = business.submitExport();
  const result = await finished(business, task.id);
  assert.equal(result.state, 'failed');
  for (const segment of [first, second]) {
    assert.ok(result.issues.some(issue => issue.segmentId === segment.id && issue.order === segment.order && issue.field === 'video'));
    assert.ok(result.issues.some(issue => issue.segmentId === segment.id && issue.field === 'speech'));
  }
  assert.equal(business.getSpeechStatus().tasks.length, 0);
});

test('全片预检汇总背景乐缺失和片段问题，任务占用期间不能修改背景乐', async ({ createDirectory, execBytes, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-music-validation-'));
  const business = openBusiness(directory);
  await selectTestStyle(business);
  business.addSegment('缺少画面与配音');
  const sourcePath = join(directory, 'music.wav');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.2', sourcePath]);
  const token = business.acquire('codex');
  const backgroundMusic = await business.setBackgroundMusic(token, null, sourcePath);
  business.release(token);
  assert.ok(backgroundMusic);
  const media = business.getSnapshot().storage.mediaDirectory;
  const files = readdirSync(media);
  assert.equal(files.length, 1);
  unlinkSync(join(media, files[0]!));

  const accepted = business.submitExport();
  assert.throws(() => business.acquire('user'), /导出进行中/);
  assert.throws(() => business.acquire('codex'), /导出进行中/);
  await assert.rejects(business.setBackgroundMusic(token, backgroundMusic.id, null), /修改权/);
  const task = await finished(business, accepted.id);
  assert.equal(task.state, 'failed');
  assert.equal(task.completed, 0);
  expect(task.issues).toEqual(expect.arrayContaining([
    { field: 'settings', message: expect.stringMatching(/music.wav.*背景乐不可读或不可解码/) },
    expect.objectContaining({ field: 'speech', order: 1 }),
    expect.objectContaining({ field: 'video', order: 1 }),
  ]));
  assert.equal(task.issues.filter(issue => issue.message.includes('背景乐')).length, 1);
  assert.deepEqual(business.getSnapshot().backgroundMusic, backgroundMusic);
});

for (const owner of ['user', 'codex'] as const) test(`${owner} 持有修改权时拒绝导出，不创建任务且原编辑可以继续`, async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-export-editing-'));
  const business = openBusiness(directory);
  await selectTestStyle(business);

  const token = business.acquire(owner);
  const before = business.getSnapshot();
  assert.throws(() => business.submitExport(), owner === 'user' ? /用户正在编辑/ : /Codex 正在修改/);
  assert.deepEqual(business.getExportTasks(), { locked: false, tasks: [] });
  assert.equal(existsSync(join(directory, 'exports')), false);
  assert.deepEqual(business.getSnapshot(), before);
  assert.equal(business.owns(token, owner), true);
  business.addSegment('继续编辑', token);
  business.release(token);
  const task = business.submitExport();
  assert.equal(task.state, 'accepted');
  assert.equal((await finished(business, task.id)).state, 'failed');
});

async function ready(t: Pick<Resources, 'createDirectory' | 'execBytes' | 'openBusiness'>, options: { duration?: number; sar?: number; speechSource?: string } = {}) {
  const root = t.createDirectory(join(tmpdir(), 'clapgrid-render-'));
  const source = join(root, 'source.mp4'); const audio = join(root, 'speech.mp3');
  (await t.execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=96x96:r=25:d=0.4', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:r=25:d=0.6', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1', '-filter_complex', `[0:v][1:v]concat=n=2:v=1:a=0,setsar=${options.sar ?? 1}[v]`, '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', source]));
  (await t.execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', options.speechSource ?? `sine=frequency=440:duration=${options.duration ?? 0.8}`, '-ar', '24000', audio]));
  let failSpeech = false;
  const payload = readFileSync(audio).toString('base64');
  const directory = join(root, 'project');
  const business = t.openBusiness(directory, { key: () => 'test-key', configPath: '.env', fetch: (async () => failSpeech
    ? new Response('失败', { status: 500 })
    : new Response(`data: {"code":0,"data":"${payload}"}\n\ndata: {"code":20000000}\n\n`)) as typeof fetch });
  await selectTestStyle(business);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= business.close();

  const token = business.acquire('codex');
  const asset = await business.importVideo(token, { sourcePath: source });
  const first = business.addSegment('第一句字幕，整句随配音显示。', token).segments[0]!;
  const second = business.addSegment('第二句字幕', token).segments[1]!;
  await business.modifyBatch(token, { changes: [
    { kind: 'video', expected: first, assetId: asset.id, start: 0.6 },
    { kind: 'video', expected: second, assetId: asset.id, start: 0 },
  ] });
  const expected = business.getSnapshot().exportSettings;
  await business.setExportSettings(token, { expected, settings: { ...expected, fps: 25 } });
  business.release(token);
  const waitSpeech = async () => {
    await expect.poll(() => business.getSpeechStatus().locked).toBeFalsy();
    assert.equal(business.getSpeechStatus().locked, false);
  };
  for (const segment of [first, second]) { business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }); await waitSpeech(); }
  const compose = async () => {
    const editing = business.acquire('codex');
    try {
      for (const segment of business.getSnapshot().segments) {
        const context = await business.getVisualContext(segment.id);
        const reference = context.segment.video!;
        await business.modifyBatch(editing, { changes: [{ kind: 'composition', expected: context.segment, plan: { duration: context.duration, layers: [{ assetId: reference.assetId, role: 'background', from: 0, to: context.duration, start: reference.start, x: 0, y: 0, width: 1, height: 1, z: 0 }] } }] });
      }
    } finally { business.release(editing); }
  };
  await compose();
  return { root, directory, business, close, asset, first, second, waitSpeech, compose, failNextSpeech: () => { failSpeech = true; } };
}

async function probe(t: Pick<Resources, 'execText'>, path: string) { return JSON.parse((await t.execText('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }))); }
function frame(t: Pick<Resources, 'execBytes'>, path: string, seconds: number) { return t.execBytes('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', path, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 8 * 1024 * 1024 }); }
function pixel(data: Buffer, x: number, y: number) { return [...data.subarray((y * 1920 + x) * 3, (y * 1920 + x) * 3 + 3)]; }

test('全片背景乐循环或截断、随配音压低并淡出，片段合成预览保留原配音', { timeout: 60000 }, async ({ createDirectory, execBytes, execText, openBusiness }) => {
  const { business, root, first } = await ready({ createDirectory, execBytes, openBusiness }, {
    speechSource: "aevalsrc=exprs='if(between(t,0.35,0.85),0,0.15*sin(2*PI*440*t))':s=24000:d=1.25",
  });
  const sourcePath = join(root, 'music.wav');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.32', '-af', 'volume=4', sourcePath]);
  const token = business.acquire('user');
  await business.setBackgroundMusic(token, null, sourcePath);
  business.release(token);

  const decode = (path: string) => execBytes('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const audioDuration = async (path: string) => {
    const metadata = await probe({ execText }, path);
    return Number(metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio').duration);
  };
  const level = (audio: Buffer, frequency: number, from: number, to: number) => {
    let real = 0; let imaginary = 0;
    const start = Math.round(from * 48000); const end = Math.round(to * 48000);
    for (let i = start; i < end; i++) {
      const sample = audio.readFloatLE(i * 4);
      const phase = 2 * Math.PI * frequency * i / 48000;
      real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase);
    }
    return 20 * Math.log10(2 * Math.hypot(real, imaginary) / (end - start));
  };

  const submitted = business.submitPreview(first.id);
  let preview: ExportTask | undefined;
  await expect.poll(() => {
    preview = business.getVisualPreviews().tasks.find(task => task.id === submitted.id);
    return preview?.state;
  }, { timeout: 30000 }).toMatch(/succeeded|failed/);
  assert.equal(preview?.state, 'succeeded', JSON.stringify(preview));
  const previewAudio = await decode(preview.output!.path);
  expect(level(previewAudio, 1000, 0.1, 0.25)).toBeLessThan(-60);
  expect(level(previewAudio, 440, 0.1, 0.25)).toBeCloseTo(-16.5, 0);

  const result = await finished(business, business.submitExport().id);
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  expect(result.technicalChecks?.loudnessAfter.integratedLufs).toBeCloseTo(-14, 0);
  const audio = await decode(result.output!.path);
  const speechLevel = level(audio, 440, 0.1, 0.25);
  const musicLevel = level(audio, 1000, 0.1, 0.25);
  expect(speechLevel - musicLevel).toBeGreaterThan(9);
  expect(speechLevel - musicLevel).toBeLessThan(11);
  expect(level(audio, 1000, 0.72, 0.82)).toBeGreaterThan(musicLevel + 4);
  expect(level(audio, 1000, 1.4, 1.55)).toBeGreaterThan(musicLevel - 2);
  expect(level(audio, 1000, 2.46, 2.49)).toBeLessThan(musicLevel - 15);
  expect(await audioDuration(result.output!.path)).toBeCloseTo(2.5, 2);

  const longTrack = join(root, 'long-music.wav');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=3.2', '-af', 'volume=4', longTrack]);
  const previous = business.getSnapshot().backgroundMusic;
  assert.ok(previous);
  const replacement = business.acquire('codex');
  const current = await business.setBackgroundMusic(replacement, previous.id, longTrack);
  business.release(replacement);
  assert.ok(current);
  expect(business.getVisualPreviews().tasks.find(task => task.id === submitted.id)?.current).toBe(true);
  const truncated = await finished(business, business.submitExport().id);
  assert.equal(truncated.state, 'succeeded', JSON.stringify(truncated));
  const truncatedAudio = await decode(truncated.output!.path);
  expect(level(truncatedAudio, 700, 0.1, 0.25)).toBeGreaterThan(-40);
  expect(await audioDuration(truncated.output!.path)).toBeCloseTo(2.5, 2);

  const media = business.getSnapshot().storage.mediaDirectory;
  const stored = readdirSync(media).find(file => file.startsWith(current.id));
  assert.ok(stored);
  // 保留成片需要的前 2.5 秒，只破坏未混入的尾部，预检仍须完整解码。
  truncateSync(join(media, stored), readFileSync(longTrack).length - 2049);
  const invalid = await finished(business, business.submitExport().id);
  assert.equal(invalid.state, 'failed');
  assert.equal(invalid.completed, 0);
  expect(invalid.issues).toEqual([{ field: 'settings', message: expect.stringMatching(/long-music.wav.*背景乐不可读或不可解码/) }]);
});

test('预览发布后成片目标冲突：撤销本次预览，不覆盖或删除原有文件', { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business, directory } = await ready(t);
  const task = business.submitExport();
  const exports = join(directory, 'exports');
  mkdirSync(exports, { recursive: true });
  const collision = join(exports, `${task.createdAt.replace(/[:.]/g, '-')}-${task.id}.mp4`);
  writeFileSync(collision, '原有文件');
  const result = await finished(business, task.id);
  assert.equal(result.state, 'failed');
  assert.match(result.message, /EEXIST/);
  assert.equal(result.completed, result.total);
  assert.deepEqual(readdirSync(exports), [collision.split('/').at(-1)]);
  assert.equal(readFileSync(collision, 'utf8'), '原有文件');
  assert.equal(existsSync(join(business.getSnapshot().storage.mediaDirectory, `${task.id}.export.webm`)), false);
  assert.throws(() => business.getExportFile(task.id), /导出未成功/);
  assert.equal(business.getExportTasks().locked, false);
});

test('成片和预览已发布后在清理期间取消：撤销两份文件，终态保存前保持占用', { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness, onTestFinished, openConnection }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business, directory } = await ready(t);
  const task = business.submitExport();
  const workspace = join(directory, 'exports', `.work-${task.id}`);
  let cleaning = false;
  let resume!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const remove = fs.rm;
  // 只延迟本次真实目录删除，精确控制取消发生在清理尚未完成时。
  const mock = vi.spyOn(fs, 'rm').mockImplementation(async (...[path, options]: Parameters<typeof fs.rm>) => {
    if (path === workspace) { cleaning = true; await paused; }
    return remove(path, options);
  });
  openConnection(() => ({ close: () => { resume(); mock.mockRestore(); } }));
  try {
    await expect.poll(() => cleaning, { timeout: 60000 }).toBeTruthy();
    const preview = join(business.getSnapshot().storage.mediaDirectory, `${task.id}.export.webm`);
    assert.equal(existsSync(preview), true);
    assert.equal(readdirSync(join(directory, 'exports')).filter(name => name.endsWith('.mp4')).length, 1);
    assert.equal(business.cancelExport(task.id).state, 'cleaning');
    assert.equal(business.getExportTasks().locked, true);
    assert.throws(() => business.acquire('user'), /导出/);
    assert.throws(() => business.getExportFile(task.id), /导出未成功/);
    resume();
    assert.equal((await finished(business, task.id)).state, 'cancelled');
    assert.deepEqual(readdirSync(join(directory, 'exports')), []);
    assert.equal(existsSync(preview), false);
    assert.equal(business.getExportTasks().locked, false);
  } finally { resume(); }
});

test('取消导出清理结束后下一例恢复真实文件删除，不泄漏暂停替身', async ({ createDirectory }) => {
  assert.equal(vi.isMockFunction(fs.rm), false);
  const directory = createDirectory(join(tmpdir(), 'clapgrid-export-rm-restored-'));
  await fs.rm(directory, { recursive: true, force: true });
  assert.equal(existsSync(directory), false);
});

test('成功产物已发布但终态保存失败：继续锁定且不可读取，重开清理后标记中断', { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness, openConnection }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business, directory, close } = await ready(t);
  const history = await finished(business, business.submitExport().id);
  assert.equal(history.state, 'succeeded');
  const historicalFile = business.getExportFile(history.id);
  const historicalPreview = business.getExportFile(history.id, 'preview');
  const historicalBytes = readFileSync(historicalFile);
  const db = openConnection(() => new DatabaseSync(business.getSnapshot().storage.database));

  db.exec(`CREATE TRIGGER reject_export_success BEFORE UPDATE ON export_tasks
    WHEN json_extract(NEW.value, '$.state') = 'succeeded'
    BEGIN SELECT RAISE(ABORT, '模拟成功状态保存失败'); END`);
  const task = business.submitExport();
  await expect.poll(() => business.getExportTasks().tasks.some(item => item.id === task.id && item.message.includes('清理或保存失败')), { timeout: 60000 }).toBeTruthy();
  const pending = business.getExportTasks().tasks.find(item => item.id === task.id)!;
  assert.equal(pending.state, 'cleaning');
  const pendingFile = join(directory, 'exports', `${task.createdAt.replace(/[:.]/g, '-')}-${task.id}.mp4`);
  const pendingPreview = join(business.getSnapshot().storage.mediaDirectory, `${task.id}.export.webm`);
  assert.equal(existsSync(pendingFile), true); assert.equal(existsSync(pendingPreview), true);
  assert.equal(existsSync(join(directory, 'exports', `.work-${task.id}`)), false);
  assert.throws(() => business.getExportFile(task.id), /导出未成功/);
  assert.throws(() => business.getExportFile(task.id, 'preview'), /导出未成功/);
  assert.throws(() => business.acquire('user'), /导出/);
  assert.equal(business.getExportTasks().locked, true);
  await close();
  db.exec('DROP TRIGGER reject_export_success');
  const reopened = openBusiness(directory);
  try {
    await expect.poll(() => !reopened.getExportTasks().locked, { timeout: 60000 }).toBeTruthy();
    const recovered = reopened.getExportTasks().tasks.find(item => item.id === task.id)!;
    assert.equal(recovered.state, 'interrupted');
    assert.equal(reopened.getExportTasks().tasks.length, 2, '重开不自动创建新的导出任务');
    assert.equal(existsSync(pendingFile), false); assert.equal(existsSync(pendingPreview), false);
    assert.deepEqual(readFileSync(reopened.getExportFile(history.id)), historicalBytes);
    assert.equal(reopened.getExportFile(history.id, 'preview'), historicalPreview);
    const token = reopened.acquire('user'); reopened.release(token);
  } finally { await reopened.close(); }
});

test('真实全片按项目顺序导出：起点、冻结、留边、风格字幕与 MP4 参数，失败的最新配音不妨碍有效旧配音', { timeout: 60000 }, async ({ createDirectory, execBytes, execText, openBusiness }) => {
  const t = { createDirectory, execBytes, execText, openBusiness };
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
  const media = (await probe(t, path)); const video = media.streams.find((stream: any) => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height, video.r_frame_rate], ['h264', 1920, 1080, '25/1']);
  assert.equal(media.streams.filter((stream: any) => stream.codec_type === 'audio').length, 1);
  const samples = (await execBytes('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', '-']));
  const energy = (hz: number) => {
    let sine = 0; let cosine = 0;
    for (let i = 2400; i < 24000; i++) { const value = samples.readFloatLE(i * 4); sine += value * Math.sin(2 * Math.PI * hz * i / 48000); cosine += value * Math.cos(2 * Math.PI * hz * i / 48000); }
    return sine * sine + cosine * cosine;
  };
  assert.ok(energy(440) > 100 * energy(1000), '只有配音，没有原视频的 1000 Hz 原声');

  assert.ok(Number(media.format.duration) >= 1.6 && Number(media.format.duration) < 1.8);
  const start = (await frame(t, path, 0.1)); const frozen = (await frame(t, path, 0.65)); const next = (await frame(t, path, 0.9));
  assert.ok(pixel(start, 960, 100)[2]! > 200, '第一片段从蓝色画面开始');
  assert.ok(pixel(frozen, 960, 100)[2]! > 200, '视频不足时蓝色末帧冻结');
  assert.ok(pixel(next, 960, 100)[0]! > 200, '第二片段紧接红色画面');
  assert.ok(pixel(start, 10, 100).every(value => value < 5), '方形视频等比缩放留边');
  let white = 0;
  for (let y = 850; y < 1070; y++) for (let x = 120; x < 1420; x++) if (pixel(start, x, y).every(value => value > 210)) white++;
  assert.ok(white > 300, '底部有风格绘制的白色字幕像素');
  assert.deepEqual(readdirSync(join(directory, 'exports')), [path.split('/').at(-1)]);
});

async function rendering(business: ReturnType<typeof openBusiness>, id: string) {
  let task: ExportTask | undefined;
  await expect.poll(() => {
    task = business.getExportTasks().tasks.find(task => task.id === id);
    return task?.state;
  }, { timeout: 10000, message: `导出任务 ${id} 未进入渲染` }).toSatisfy(state => ['rendering', 'failed', 'cancelled', 'succeeded', 'interrupted'].includes(state));
  assert.equal(task!.state, 'rendering', JSON.stringify(task));
}

test('取消真实渲染显示清理状态，停止并删除本次文件后才解锁，保留历史成片', { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness }) => {
  const t = { createDirectory, execBytes, openBusiness };
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

for (const { name, output, completed } of [
  { name: '片段渲染失败时定位片段并', output: 'clip-0.mkv', completed: 0 },
  { name: '标准化编码失败时', output: 'result.mp4', completed: 2 },
]) test(`${name}清理半成品，已有成片保留且项目恢复编辑`, { timeout: 60000 }, async ({ createDirectory, execBytes, execText, openBusiness }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business, directory, root, first } = await ready(t);
  const actualFfmpeg = (await execText('which', ['ffmpeg'], { encoding: 'utf8' })).trim();
  const shim = join(root, 'bin'); mkdirSync(shim);
  writeFileSync(join(shim, 'ffmpeg'), `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (args.at(-1) === ${JSON.stringify(output)}) { fs.writeFileSync(args.at(-1), '半成品'); console.error('模拟编码器运行失败'); process.exit(7); }\nconst result = require('node:child_process').spawnSync(${JSON.stringify(actualFfmpeg)}, args, {stdio:'inherit', timeout:10000, killSignal:'SIGKILL'}); process.exit(result.status ?? 1);\n`, { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = `${shim}:${previous}`;
  try {
    mkdirSync(join(directory, 'exports')); writeFileSync(join(directory, 'exports', 'previous.mp4'), '已有成片');
    const result = await finished(business, business.submitExport().id);
    assert.equal(result.state, 'failed'); assert.match(result.message, /模拟编码器运行失败/);
    assert.equal(result.completed, completed);
    assert.equal(result.output, undefined);
    const segmentId = output === 'clip-0.mkv' ? first.id : undefined;
    assert.equal(result.segmentId, segmentId);
    assert.equal(result.issues.at(-1)?.segmentId, segmentId);
    assert.deepEqual(readdirSync(join(directory, 'exports')), ['previous.mp4']);
    const token = business.acquire('user'); business.release(token);
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
});

test('损坏视频、真实时长变化导致起点失效、待更新或损坏配音一次汇总且不产生成片', async ({ createDirectory, execBytes, openBusiness }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business, first, second, asset, directory, root } = await ready(t);
  const source = business.getMedia(asset.id, 'source');
  const shorter = join(root, 'short.mp4');
  (await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=96x96:d=0.4', '-c:v', 'libx264', shorter]));
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
  assert.equal(result.issues.filter(issue => issue.field === 'video' && issue.message.includes('不可读或不可解码')).length, 2);
  assert.equal(business.getSpeechStatus().tasks.length, 2);
  assert.deepEqual(readdirSync(join(directory, 'exports')), []);
});

for (const { name, source } of [
  { name: '完全静音', source: 'anullsrc=r=24000:cl=mono:d=0.8' },
  { name: '低于 −50 dBFS', source: 'sine=frequency=440:duration=0.8,volume=-36dB' },
]) test(`有效配音${name}时在校验阶段定位到口播片段`, async ({ createDirectory, execBytes, openBusiness }) => {
  const { business, directory, root, second } = await ready({ createDirectory, execBytes, openBusiness });
  const silent = join(root, 'silent.mp3');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', source, '-ar', '24000', silent]);
  writeFileSync(business.getCurrentSpeechAudio(second.id), readFileSync(silent));
  const result = await finished(business, business.submitExport().id);
  expect(result).toMatchObject({ state: 'failed', completed: 0, issues: [{
    segmentId: second.id, order: second.order, field: 'speech', message: '配音为静音，请重新生成',
  }] });
  expect(result.output).toBeUndefined();
  expect(readdirSync(join(directory, 'exports'))).toEqual([]);
});

test('响度无法测量时停止导出并清理本次文件', { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness }) => {
  // 两段可听的配音合计不足一个 400 ms 的综合响度测量窗口。
  const { business, directory } = await ready({ createDirectory, execBytes, openBusiness }, { duration: 0.12 });
  const result = await finished(business, business.submitExport().id);
  expect(result).toMatchObject({ state: 'failed', completed: 2, issues: [] });
  expect(result.message).toContain('无法读取标准化前的响度测量值');
  expect(result.output).toBeUndefined();
  expect(readdirSync(join(directory, 'exports'))).toEqual([]);
});

for (const { name, blackOrders, interval } of [
  { name: '中间恰好一秒', blackOrders: [2], interval: { start: 1, end: 2 } },
  { name: '跨两个片段至片尾', blackOrders: [2, 3], interval: { start: 1, end: 3 } },
  { name: '片尾恰好一秒', blackOrders: [3], interval: { start: 2, end: 3 } },
]) test(`黑场${name}时按全片时间定位且允许导出`, { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness }) => {
  const { business, root, asset, waitSpeech, compose } = await ready({ createDirectory, execBytes, openBusiness }, { duration: 1 });
  const black = join(root, 'black.mp4');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=96x96:r=25:d=1', '-c:v', 'libx264', black]);
  const token = business.acquire('codex');
  const blackAsset = await business.importVideo(token, { sourcePath: black });
  const segments = business.addSegment('第三句字幕', token).segments;
  const third = segments[2]!;
  await business.modifyBatch(token, { changes: segments.slice(1).map(segment => ({
    kind: 'video', expected: segment, assetId: blackOrders.includes(segment.order) ? blackAsset.id : asset.id, start: 0,
  })) });
  business.release(token);
  business.submitSpeech({ requestId: randomUUID(), segmentId: third.id }); await waitSpeech();
  await compose();

  const result = await finished(business, business.submitExport().id);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'succeeded', technicalChecks: { blackIntervals: [interval] } });
  const blackWarnings = result.warnings.filter(warning => warning.message.includes('黑场'));
  expect(blackWarnings).toEqual(blackOrders.map(order => ({
    order, segmentId: segments[order - 1]!.id, field: 'video',
    message: `检测到黑场 ${interval.start.toFixed(1)}–${interval.end.toFixed(1)} 秒（全片时间），可能为有意设计`,
  })));
});

test('再次导出使用新内容和设置，生成唯一文件且保留原成片，长文案仍可导出', { timeout: 60000 }, async ({ createDirectory, execBytes, execText, openBusiness }) => {
  const t = { createDirectory, execBytes, execText, openBusiness };
  const { business, first, waitSpeech, compose } = await ready(t);
  const original = await finished(business, business.submitExport().id);
  assert.equal(original.state, 'succeeded');
  const before = readFileSync(original.output!.path);
  const long = '这是一句完整显示的长文案，用于验证字幕能够自动换行而不被拆成多个片段。'.repeat(5);
  business.editSegment(first.id, long);
  business.submitSpeech({ requestId: randomUUID(), segmentId: first.id }); await waitSpeech();
  await compose();
  const token = business.acquire('user'); const expected = business.getSnapshot().exportSettings;
  await business.setExportSettings(token, { expected, settings: { ...expected, codec: 'mpeg4', fps: 30 } }); business.release(token);
  const result = await finished(business, business.submitExport().id);
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  assert.equal(result.total, 2); assert.notEqual(result.output!.path, original.output!.path);
  assert.deepEqual(readFileSync(original.output!.path), before);
  assert.ok(existsSync(result.output!.path));
  const media = (await probe(t, result.output!.path)); const video = media.streams.find((stream: any) => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.r_frame_rate], ['mpeg4', '30/1']);
  assert.ok(result.warnings.every(issue => issue.field === 'video'));
  const image = (await frame(t, result.output!.path, 0.1));
  let whites = 0;
  for (let y = 940; y < 1000; y++) {
    for (let x = 120; x < 1780; x++) if (pixel(image, x, y).every(value => value > 220)) whites++;
  }
  assert.ok(whites > 300, '新成片保留风格绘制的长文案');
});

test('配音刚受理及生成时拒绝导出且不创建任务，结束后恢复前置校验', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-export-speech-lock-'));
  let finish!: (response: Response) => void;
  const business = openBusiness(directory, { configPath: '.env', key: () => 'key', fetch: (async () => new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch });

  await selectTestStyle(business);
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
  await expect.poll(() => business.getSpeechStatus().locked).toBeFalsy();
  const token = business.acquire('user'); business.release(token);
  const result = await finished(business, business.submitExport().id);
  assert.equal(result.state, 'failed');
  assert.ok(result.issues.some(issue => issue.field === 'video'));
  assert.ok(result.issues.every(issue => !/配音任务尚未结束/.test(issue.message)));

});

test('配音时长不是视频帧整倍数时，拼接处不插入静音间隔', { timeout: 60000 }, async ({ createDirectory, execBytes, execText, openBusiness }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business } = await ready(t, { duration: 0.83 });
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded');
  const samples = (await execBytes('ffmpeg', ['-v', 'error', '-i', task.output!.path, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', '-']));
  let square = 0;
  for (let i = 40032; i < 40224; i++) square += samples.readFloatLE(i * 4) ** 2;
  assert.ok(Math.sqrt(square / 192) > 0.05, '0.834–0.838 秒处应已开始第二段配音，不能存在按帧补齐的静音');
  const packets = JSON.parse((await execText('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pts,duration', '-of', 'json', task.output!.path], { encoding: 'utf8' }))).packets;
  assert.ok(packets.every((packet: { duration: number }) => packet.duration <= 1024), 'AAC 包不能因片段取整增加播放时间间隔');
  for (let i = 1; i < packets.length; i++) assert.equal(packets[i].pts - packets[i - 1].pts, 1024);

});

test('非方形像素视频按显示宽高比缩放，不能压成方形', { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business } = await ready(t, { sar: 2 });
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded');
  const image = (await frame(t, task.output!.path, 0.1));
  assert.ok(pixel(image, 100, 540)[2]! > 200, '2:1 显示比例应铺满宽度');
  assert.ok(pixel(image, 960, 10).every(value => value < 5), '上下留边保持显示比例');
});

test('合法起点落在视频末帧持续区间内时，使用末帧冻结而不是丢失画面', { timeout: 60000 }, async ({ createDirectory, execBytes, openBusiness }) => {
  const t = { createDirectory, execBytes, openBusiness };
  const { business, asset, compose } = await ready(t);
  const token = business.acquire('user');
  await business.modifyBatch(token, { changes: [{ kind: 'video', expected: business.getSnapshot().segments[0]!, assetId: asset.id, start: 0.99 }] }); business.release(token);
  await compose();
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded', JSON.stringify(task));
  assert.ok(pixel((await frame(t, task.output!.path, 0.1)), 960, 100)[2]! > 200);
});

test('成片提供含字幕和声音的浏览器兼容预览，MP4 原文件仍独立保留', { timeout: 60000 }, async ({ createDirectory, execBytes, execText, openBusiness }) => {
  const t = { createDirectory, execBytes, execText, openBusiness };
  const { business } = await ready(t);
  const task = await finished(business, business.submitExport().id);
  assert.equal(task.state, 'succeeded');
  assert.ok(task.output!.previewUrl);
  const preview = business.getExportFile(task.id, 'preview');
  const media = (await probe(t, preview));
  assert.equal(media.streams.find((stream: any) => stream.codec_type === 'video').codec_name, 'vp8');
  assert.equal(media.streams.find((stream: any) => stream.codec_type === 'audio').codec_name, 'vorbis');
  assert.equal(business.getExportFile(task.id), task.output!.path);
});

test('兼容视频写入口保留关联和起点，未保存编排时拒绝自动均分或贯穿导出', async ({ createDirectory, execBytes, openBusiness }) => {
  const { business, asset } = await ready({ createDirectory, execBytes, openBusiness });
  const token = business.acquire('codex');
  await business.modifyBatch(token, { changes: [{ kind: 'videos', expected: business.getSnapshot().segments[0]!, videos: [{ assetId: asset.id, start: 0 }, { assetId: asset.id, start: 0.6 }] }] });
  business.release(token);
  const result = await finished(business, business.submitExport().id);
  assert.equal(result.state, 'failed');
  assert.ok(result.issues.some(issue => issue.message.includes('编排缺失')));
  assert.equal(business.getSnapshot().segments[0]!.additionalVideos?.[0]?.start, 0.6);
});
