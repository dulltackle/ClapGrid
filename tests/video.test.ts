import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openBusiness } from '../src/business/index.js';

test('指定的项目外视频复制到项目，源文件变化后仍可复用并重开', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-video-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-c:v', 'libx264', source]);
  const directory = join(root, 'project');
  let business = openBusiness(directory);
  t.after(() => business.close());
  const token = business.acquire('codex');
  const asset = await business.importVideo(token, { sourcePath: source });
  assert.equal(asset.duration, 1);
  writeFileSync(source, '源文件已变化');
  const first = business.addSegment('甲', token).segments[0]!;
  const second = business.addSegment('乙', token).segments[1]!;
  const result = await business.modifyBatch(token, { changes: [
    { kind: 'video', expected: first, assetId: asset.id, start: 0.25 },
    { kind: 'video', expected: second, assetId: asset.id, start: 0 },
  ] });
  assert.equal(result.summary.applied, 2);
  business.release(token);
  const snapshot = business.getSnapshot();
  assert.equal(snapshot.assets.length, 1);
  assert.deepEqual(snapshot.segments.map(s => s.video), [{ assetId: asset.id, start: 0.25 }, { assetId: asset.id, start: 0 }]);
  business.close();
  business = openBusiness(directory);
  assert.deepEqual(business.getSnapshot(), snapshot);
});

test('拒绝不可解码媒体与无效起点，替换、解除和删除片段保留素材', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-video-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:d=1', '-c:v', 'libx264', source]);
  const business = openBusiness(join(root, 'project'));
  t.after(() => business.close());
  const token = business.acquire('codex');
  const asset = await business.importVideo(token, { sourcePath: source });
  const replacement = await business.importVideo(token, { sourcePath: source });
  const original = business.addSegment('边界', token).segments[0]!;
  const apply = (assetId: string | null, start: number) => business.modifyBatch(token, { changes: [{ kind: 'video', expected: business.getSnapshot().segments[0]!, assetId, start }] });
  assert.equal((await apply(asset.id, 0.5)).summary.applied, 1);
  const saved = business.getSnapshot();
  for (const start of [-1, NaN, Infinity]) {
    await assert.rejects(apply(asset.id, start));
    assert.deepEqual(business.getSnapshot(), saved);
  }
  for (const start of [1, 2]) {
    assert.equal((await apply(asset.id, start)).summary.failed, 1);
    assert.deepEqual(business.getSnapshot(), saved);
  }
  const stale = await business.modifyBatch(token, { changes: [{ kind: 'video', expected: original, assetId: replacement.id, start: 0 }] });
  assert.equal(stale.summary.changed, 1);
  assert.equal((await apply(replacement.id, 0)).summary.applied, 1);
  assert.equal((await apply(null, 0)).summary.applied, 1);
  assert.equal(business.getSnapshot().segments[0]!.video, null);
  assert.equal((await apply(asset.id, 0)).summary.applied, 1);
  writeFileSync(business.getMedia(replacement.id, 'source'), '损坏的视频');
  assert.equal((await apply(replacement.id, 0)).summary.failed, 1);
  assert.equal(business.getSnapshot().segments[0]!.video!.assetId, asset.id);
  writeFileSync(source, '不是视频');
  await assert.rejects(business.importVideo(token, { sourcePath: source }));
  assert.equal(business.getSnapshot().assets.length, 2);
  await business.modifyBatch(token, { changes: [{ kind: 'delete', expected: business.getSnapshot().segments[0]! }] });
  for (const id of [asset.id, replacement.id]) {
    assert.ok(business.getMedia(id, 'source'));
    assert.ok(business.getMedia(id, 'preview'));
    assert.ok(business.getMedia(id, 'thumbnail'));
  }
  business.release(token);
  await assert.rejects(business.importVideo(token, { sourcePath: source }), /修改权/);
});

test('目标已删除时跳过关联，不因损坏素材把已删除目标报告为失败', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-video-deleted-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const business = openBusiness(root); t.after(() => business.close());
  const token = business.acquire('codex');
  const expected = business.addSegment('待删除', token).segments[0]!;
  await business.modifyBatch(token, { changes: [{ kind: 'delete', expected }] });
  const result = await business.modifyBatch(token, { changes: [{ kind: 'video', expected, assetId: expected.id, start: 0 }] });
  assert.equal(result.summary.deleted, 1);
});

test('视频时长由画面决定，较长音轨不能放宽播放起点', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-video-duration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'long-audio.mkv');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx264', '-c:a', 'pcm_s16le', sourcePath]);
  const business = openBusiness(join(root, 'project')); t.after(() => business.close());
  const token = business.acquire('codex');
  const asset = await business.importVideo(token, { sourcePath });
  assert.equal(asset.duration, 1);
  const expected = business.addSegment('短画面长音轨', token).segments[0]!;
  const result = await business.modifyBatch(token, { changes: [{ kind: 'video', expected, assetId: asset.id, start: 1.5 }] });
  assert.equal(result.summary.failed, 1);
});


test('导入不跟随来源链接或播放列表，断开修改权会取消尚未提交的导入', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-video-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-c:v', 'libx264', source]);
  const business = openBusiness(join(root, 'project')); t.after(() => business.close());
  const token = business.acquire('codex');
  symlinkSync(source, join(root, 'alias.mp4'));
  await assert.rejects(business.importVideo(token, { sourcePath: join(root, 'alias.mp4') }), /不安全/);
  const list = join(root, 'list.m3u8');
  writeFileSync(list, '#EXTM3U\n#EXTINF:1,\n' + source + '\n');
  await assert.rejects(business.importVideo(token, { sourcePath: list }));
  await assert.rejects(business.importVideo(token, { sourcePath: 'relative.mp4' }), /绝对路径/);
  await assert.rejects(business.importVideo(token, { sourcePath: root }));
  const pending = business.importVideo(token, { sourcePath: source });
  assert.throws(() => business.acquire('user'), /Codex 正在修改/);
  business.release(token);
  await assert.rejects(pending);
  assert.equal(business.getSnapshot().assets.length, 0);
  const next = business.acquire('user');
  business.release(next);
});

test('多视频轨道素材的缩略图与预览使用同一画面', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-video-tracks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'tracks.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:d=1', '-map', '0:v', '-map', '1:v', '-c:v', 'libx264', '-disposition:v:0', '0', '-disposition:v:1', 'default', sourcePath]);
  const business = openBusiness(join(root, 'project')); t.after(() => business.close());
  const token = business.acquire('codex');
  const asset = await business.importVideo(token, { sourcePath });
  for (const kind of ['preview', 'thumbnail'] as const) {
    const pixel = execFileSync('ffmpeg', ['-v', 'error', '-i', business.getMedia(asset.id, kind), '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    assert.ok(pixel[0]! > 200 && pixel[2]! < 30, `${kind} 应显示首视频轨道的红色画面`);
  }
});
