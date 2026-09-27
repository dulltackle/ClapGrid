import { constants, createReadStream, createWriteStream, fstatSync, lstatSync, openSync, closeSync, realpathSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { VideoAsset } from '../shared/contracts.js';

const execute = promisify(execFile);
// 排除播放列表、网络协议及外部引用格式，解码器只能读取已复制的单个媒体文件。
const inputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,flv,mpeg,mpegts,ogg'];
export function mediaPath(directory: string, id: string, kind: 'source' | 'preview' | 'thumbnail') {
  return join(directory, `${id}.${kind === 'source' ? 'source' : kind === 'preview' ? 'webm' : 'png'}`);
}
export function verifyMedia(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== resolve(path)) throw new Error('媒体路径不安全或文件已丢失');
}
async function run(command: string, args: string[], signal: AbortSignal) {
  try { return await execute(command, args, { signal, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('请安装提供 ffmpeg、ffprobe 和 libvpx 编码器的 FFmpeg 后重试');
    throw new Error('视频不可解码、处理超时或操作已取消');
  }
}
export async function validateVideo(path: string, signal: AbortSignal) {
  verifyMedia(path);
  const { stdout } = await run('ffprobe', ['-v', 'error', ...inputOptions, '-select_streams', 'v:0', '-show_entries', 'stream=index', '-of', 'json', path], signal);
  if (!JSON.parse(stdout).streams?.length) throw new Error('文件没有可解码的视频轨道');
  // 完整解码并读取画面时间，不能把更长的音轨或容器时长当作视频时长。
  await run('ffmpeg', ['-v', 'error', '-xerror', ...inputOptions, '-i', path, '-map', '0:v:0', '-an', '-f', 'null', '-'], signal);
  // 逐帧读取时间戳与持续时间；流式消费以免长视频堆积探测输出。
  const duration = await new Promise<number>((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', ...inputOptions, '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time', '-of', 'compact=p=0:nk=0', path], { signal, timeout: 10 * 60 * 1000, stdio: ['ignore', 'pipe', 'ignore'] });
    let first = Infinity; let end = -Infinity;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      const fields = Object.fromEntries(line.split('|').map(field => field.split('=')));
      const time = Number(fields.best_effort_timestamp_time);
      const frameDuration = Number(fields.pkt_duration_time);
      if (Number.isFinite(time) && Number.isFinite(frameDuration) && frameDuration > 0) {
        first = Math.min(first, time); end = Math.max(end, time + frameDuration);
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      lines.close();
      if (code !== 0 || !Number.isFinite(end - first) || end <= first) reject(new Error('无法确认视频画面时长'));
      else resolve(Math.round((end - first) * 1_000_000) / 1_000_000);
    });
  });
  return duration;
}
export async function prepareVideo(directory: string, id: string, sourcePath: string, signal: AbortSignal): Promise<VideoAsset> {
  if (!isAbsolute(sourcePath)) throw new Error('请提供用户明确指定的视频绝对路径');
  verifyMedia(sourcePath);
  const source = mediaPath(directory, id, 'source');
  // 独占创建副本；源路径不递归扫描，不随素材记录保存。
  const descriptor = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('导入来源必须是普通文件');
    await pipeline(createReadStream('', { fd: descriptor, autoClose: false }), createWriteStream(source, { flags: 'wx' }), { signal });
  } finally { closeSync(descriptor); }
  const duration = await validateVideo(source, signal);
  await run('ffmpeg', ['-v', 'error', '-xerror', ...inputOptions, '-i', source, '-map', '0:v:0', '-an', '-vf', 'setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-f', 'webm', mediaPath(directory, id, 'preview')], signal);
  await run('ffmpeg', ['-v', 'error', ...inputOptions, '-i', source, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=160:90:force_original_aspect_ratio=decrease', '-f', 'image2', mediaPath(directory, id, 'thumbnail')], signal);
  return { id, name: basename(sourcePath), duration };
}
// 仅清理由本次失败导入创建的文件；已提交素材永不自动清理。
export function discardImport(directory: string, id: string) {
  for (const kind of ['source', 'preview', 'thumbnail'] as const) {
    try { unlinkSync(mediaPath(directory, id, kind)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
