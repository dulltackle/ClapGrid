import { pageGeometry } from './page-worker-input.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { renderCachedPage } from './page-render-cache.js';
import { pageStore } from './pages.js';
import { styleStore } from './styles.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportSegmentBoundary, ExportSettings, Segment, VisualPlan } from '../shared/contracts.js';
import { exportEncodingArguments } from './export-media.js';
import { mediaProcess } from './media-process.js';

export type RenderSegment = { segment: Segment; projectDirectory: string; styleId?: string; assetMimes?: Record<string, string>; videos: { path: string; start: number; assetId?: string; kind?: 'image' | 'video' }[]; plan?: VisualPlan; audio: string; duration: number };
const localInput = ['-protocol_whitelist', 'file,pipe'];

export async function prepareExportAudio(source: string, directory: string, index: number, signal: AbortSignal) {
  const audio = join(directory, `audio-${index}.wav`);
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', ...localInput, '-format_whitelist', 'mp3,wav', '-i', source, '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', audio], { signal });
  const { stdout } = await mediaProcess('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audio], { signal });
  const duration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法确认配音时长');
  return { audio, duration };
}

export async function renderExportSegment(input: RenderSegment, settings: ExportSettings, directory: string, index: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const { projectDirectory, styleId } = input;
  if (styleId) styleStore(projectDirectory).read(styleId);
  const plan = input.plan;
  if (!plan && input.videos.length !== 1) throw new Error('请由 agent 保存明确画面编排，不能自动均分素材时长');
  const layers = plan?.layers ?? [{ kind: 'asset' as const, assetId: input.videos[0]!.assetId, role: 'background', from: 0, to: input.duration, start: input.videos[0]!.start, x: 0, y: 0, width: 1, height: 1, z: 0 }];
  const ordered = layers.map((layer, index) => ({ ...layer, index })).sort((a, b) => a.z - b.z || a.index - b.index);
  const sources: { path: string; kind?: 'image' | 'video'; rendered?: boolean }[] = [];
  const assetHashes = new Map<string, string>();
  async function assetIdentity(path: string, mime: string) {
    const previous = assetHashes.get(path);
    if (previous) return previous;
    const hash = createHash('sha256').update(mime);
    for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
    const digest = hash.digest('hex');
    assetHashes.set(path, digest);
    return digest;
  }
  for (const layer of ordered) {
    if (layer.kind === 'page') {
      pageStore(projectDirectory).read(layer.pageId);
      const output = join(directory, `page-${index}-${layer.index}.mkv`);
      const config = join(directory, `page-${index}-${layer.index}.json`);
      const assets = Object.fromEntries(layer.assetIds.map(id => {
        const source = input.videos.find(video => video.assetId === id);
        if (!source) throw new Error('页面声明的素材缺失');
        return [id, { path: source.path, mime: input.assetMimes?.[id] ?? 'application/octet-stream' }];
      }));
      const identities = Object.fromEntries(await Promise.all(Object.entries(assets).map(async ([id, { path, mime }]) => [id, await assetIdentity(path, mime)])));
      const path = await renderCachedPage({ projectDirectory, styleId, pageId: layer.pageId, assets, ...pageGeometry(layer), duration: layer.to - layer.from, fps: settings.fps, transparent: layer.role === 'overlay', output }, identities, config, signal);
      sources.push({ path, rendered: true }); continue;
    }
    const source = input.videos.find(video => video.assetId === layer.assetId);
    if (!source) throw new Error('编排素材缺失'); sources.push(source);
  }
  const filters = [`color=c=black:s=1920x1080:r=${settings.fps}:d=${input.duration}[base]`];
  for (const [index, layer] of ordered.entries()) {
    const width = Math.max(2, (layer.kind === 'page' ? Math.round : Math.floor)(1920 * layer.width / 2) * 2);
    const height = Math.max(2, (layer.kind === 'page' ? Math.round : Math.floor)(1080 * layer.height / 2) * 2);
    const duration = layer.to - layer.from;
    const start = layer.kind === 'page' ? 0 : layer.start;
    filters.push(`[${index}:v:0]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${input.duration + start},trim=start=${start},setpts=PTS-STARTPTS,scale=w='max(2,trunc(min(${width},${height}*dar)/2)*2)':h='max(2,trunc(min(${height},${width}/dar)/2)*2)',setsar=1,format=rgba,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=${settings.fps},tpad=stop_mode=clone:stop_duration=${input.duration},trim=duration=${duration},setpts=PTS-STARTPTS+${layer.from}/TB[v${index}]`);
    filters.push(`[${index ? 'b' + (index - 1) : 'base'}][v${index}]overlay=x=${Math.round(1920 * layer.x)}:y=${Math.round(1080 * layer.y)}:eof_action=pass:repeatlast=0:enable='gte(t,${layer.from})*lt(t,${layer.to})'[b${index}]`);
  }
  const visual = `b${ordered.length - 1}`;
  if (styleId) {
    const output = join(directory, `subtitle-${index}.mkv`);
    const path = await renderCachedPage({
      projectDirectory, styleId, subtitleText: input.segment.text, assets: {}, width: 1920, height: 1080,
      duration: input.duration, fps: settings.fps, transparent: true, output,
    }, {}, join(directory, `subtitle-${index}.json`), signal);
    filters.push(`[${visual}][${sources.length}:v:0]overlay=eof_action=pass:repeatlast=0[out]`);
    sources.push({ path, rendered: true });
  } else filters.push(`[${visual}]null[out]`);
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-filter_complex_threads', '1', ...sources.flatMap(source => [...localInput, ...(source.rendered ? ['-format_whitelist', 'matroska,webm'] : []), ...(source.kind === 'image' ? ['-loop', '1', '-framerate', String(settings.fps)] : []), '-i', source.path]),
    ...localInput, '-i', input.audio, '-map', '[out]', '-map', `${sources.length}:a:0`, '-filter_complex', filters.join(';'), '-t', String(input.duration),
    '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'pcm_s16le', '-f', 'matroska', `clip-${index}.mkv`], { cwd: directory, signal });
}

export async function assembleExport(segments: RenderSegment[], settings: ExportSettings, directory: string, signal: AbortSignal) {
  let start = 0;
  const segmentBoundaries: ExportSegmentBoundary[] = segments.map(({ segment, duration }) => {
    // 拼接器先把起点对齐到 Matroska 的毫秒时间戳，fps 滤镜再取最近的输出帧。
    const visualStart = Math.round(Math.round(start * 1000) * settings.fps / 1000) / settings.fps;
    const boundary = { order: segment.order, segmentId: segment.id, start, duration, visualStart };
    start = Number((start + duration).toFixed(6));
    return boundary;
  });
  // 时间轴以精确配音时长相接，不能使用按视频帧向上取整的容器时长。
  await writeFile(join(directory, 'clips.txt'), segmentBoundaries.map(({ duration }, index) => `file clip-${index}.mkv\nduration ${duration}`).join('\n'), { flag: 'wx' });
  signal.throwIfAborted();
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-f', 'concat', '-safe', '1', '-i', 'clips.txt', '-map', '0:v:0', '-map', '0:a:0',
    '-vf', `fps=${settings.fps}:round=near`, '-af', 'asetpts=N/SR/TB', ...exportEncodingArguments(settings), '-threads', '2', '-c:a', 'aac', '-movflags', '+faststart', 'result.mp4'], { cwd: directory, signal });
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-i', 'result.mp4', '-f', 'null', '-'], { cwd: directory, signal });
  return { path: join(directory, 'result.mp4'), segmentBoundaries };
}

/** 内置浏览器可能不含 MP4 专有解码器，提供单独的 WebM 播放预览。 */
export async function renderExportPreview(directory: string, signal: AbortSignal) {
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-i', 'result.mp4', '-map', '0:v:0', '-map', '0:a:0',
    '-vf', 'scale=960:540', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1400k', '-threads', '2', '-c:a', 'libvorbis', '-q:a', '4', 'preview.webm'], { cwd: directory, signal });
  return join(directory, 'preview.webm');
}
