import { pageGeometry, runPageWorker } from './page-worker-input.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportSettings, Segment, VisualPlan } from '../shared/contracts.js';
import { exportEncodingArguments } from './export-media.js';
import { mediaProcess } from './media-process.js';

export type RenderSegment = { segment: Segment; projectDirectory?: string; assetMimes?: Record<string, string>; videos: { path: string; start: number; assetId?: string; kind?: 'image' | 'video' }[]; plan?: VisualPlan; audio: string; duration: number };
const localInput = ['-protocol_whitelist', 'file,pipe'];

export async function prepareExportAudio(source: string, directory: string, index: number, signal: AbortSignal) {
  const audio = join(directory, `audio-${index}.wav`);
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', ...localInput, '-format_whitelist', 'mp3,wav', '-i', source, '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', audio], { signal });
  const { stdout } = await mediaProcess('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audio], { signal });
  const duration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法确认配音时长');
  return { audio, duration };
}

export function subtitle(settings: ExportSettings, text: string, mask = false) {
  // 阻止文案被当作 ASS 样式或换行指令；显式文案换行仍保留。
  const literal = text.replaceAll('\\', '\\\u2060').replaceAll('{', '\\{').replaceAll('}', '\\}').replace(/\r\n|\r|\n/g, '\\N');
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${settings.fontFamily},${settings.fontSize},&H00FFFFFF,&H000000FF,${mask ? "&H00FFFFFF" : "&H00000000"},&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,80,80,48,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,999:00:00.00,Default,,0,0,0,,${literal}
`;
}

export async function renderExportSegment(input: RenderSegment, settings: ExportSettings, directory: string, index: number, signal: AbortSignal) {
  await writeFile(join(directory, `subtitle-${index}.ass`), subtitle(settings, input.segment.text), { flag: 'wx' });
  signal.throwIfAborted();
  const plan = input.plan;
  if (!plan && input.videos.length !== 1) throw new Error('请由 agent 保存明确画面编排，不能自动均分素材时长');
  const layers = plan?.layers ?? [{ kind: 'asset' as const, assetId: input.videos[0]!.assetId, role: 'background', from: 0, to: input.duration, start: input.videos[0]!.start, x: 0, y: 0, width: 1, height: 1, z: 0 }];
  const ordered = layers.map((layer, index) => ({ ...layer, index })).sort((a, b) => a.z - b.z || a.index - b.index);
  const sources = [];
  for (const layer of ordered) {
    if (layer.kind === 'page') {
      if (!input.projectDirectory) throw new Error('页面项目路径缺失');
      const output = join(directory, `page-${index}-${layer.index}.mkv`);
      const config = join(directory, `page-${index}-${layer.index}.json`);
      const assets = Object.fromEntries(layer.assetIds.map(id => {
        const source = input.videos.find(video => video.assetId === id);
        if (!source) throw new Error('页面声明的素材缺失');
        return [id, { path: source.path, mime: input.assetMimes?.[id] ?? 'application/octet-stream' }];
      }));
      await runPageWorker({ projectDirectory: input.projectDirectory, pageId: layer.pageId, assets, ...pageGeometry(layer), duration: layer.to - layer.from, fps: settings.fps, transparent: layer.role === 'overlay', output }, config, signal);
      sources.push({ path: output, start: 0, kind: 'video' }); continue;
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
  filters.push(`[b${ordered.length - 1}]subtitles=subtitle-${index}.ass:wrap_unicode=1[out]`);
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-filter_complex_threads', '1', ...sources.flatMap(source => [...localInput, ...(source.kind === 'image' ? ['-loop', '1', '-framerate', String(settings.fps)] : []), '-i', source.path]),
    ...localInput, '-i', input.audio, '-map', '[out]', '-map', `${sources.length}:a:0`, '-filter_complex', filters.join(';'), '-t', String(input.duration),
    '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'pcm_s16le', '-f', 'matroska', `clip-${index}.mkv`], { cwd: directory, signal });
}

export async function assembleExport(segments: RenderSegment[], settings: ExportSettings, directory: string, signal: AbortSignal) {
  // 时间轴以精确配音时长相接，不能使用按视频帧向上取整的容器时长。
  await writeFile(join(directory, 'clips.txt'), segments.map((segment, index) => `file clip-${index}.mkv\nduration ${segment.duration}`).join('\n'), { flag: 'wx' });
  signal.throwIfAborted();
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-f', 'concat', '-safe', '1', '-i', 'clips.txt', '-map', '0:v:0', '-map', '0:a:0',
    '-vf', `fps=${settings.fps}`, '-af', 'asetpts=N/SR/TB', ...exportEncodingArguments(settings), '-threads', '2', '-c:a', 'aac', '-movflags', '+faststart', 'result.mp4'], { cwd: directory, signal });
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-i', 'result.mp4', '-f', 'null', '-'], { cwd: directory, signal });
  return join(directory, 'result.mp4');
}

/** 内置浏览器可能不含 MP4 专有解码器，提供单独的 WebM 播放预览。 */
export async function renderExportPreview(directory: string, signal: AbortSignal) {
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-i', 'result.mp4', '-map', '0:v:0', '-map', '0:a:0',
    '-vf', 'scale=960:540', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1400k', '-threads', '2', '-c:a', 'libvorbis', '-q:a', '4', 'preview.webm'], { cwd: directory, signal });
  return join(directory, 'preview.webm');
}
