import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportSettings, Segment } from '../shared/contracts.js';
import { exportEncodingArguments } from './export-media.js';
import { mediaProcess } from './media-process.js';

export type RenderSegment = { segment: Segment; video: string; audio: string; duration: number };
const localInput = ['-protocol_whitelist', 'file,pipe'];

export async function prepareExportAudio(source: string, directory: string, index: number, signal: AbortSignal) {
  const audio = join(directory, `audio-${index}.wav`);
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', ...localInput, '-format_whitelist', 'mp3,wav', '-i', source, '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', audio], { signal });
  const { stdout } = await mediaProcess('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audio], { signal });
  const duration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法确认配音时长');
  return { audio, duration };
}

function subtitle(settings: ExportSettings, text: string) {
  // 阻止文案被当作 ASS 样式或换行指令；显式文案换行仍保留。
  const literal = text.replaceAll('\\', '\\\u2060').replaceAll('{', '\\{').replaceAll('}', '\\}').replace(/\r\n|\r|\n/g, '\\N');
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${settings.fontFamily},${settings.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,80,80,48,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,999:00:00.00,Default,,0,0,0,,${literal}
`;
}

export async function renderExportSegment(input: RenderSegment, settings: ExportSettings, directory: string, index: number, signal: AbortSignal) {
  await writeFile(join(directory, `subtitle-${index}.ass`), subtitle(settings, input.segment.text), { flag: 'wx' });
  signal.throwIfAborted();
  // 先延展末帧再截取，避免合法起点处于末帧持续区间时准确 seek 丢掉全部画面。
  // dar 包含输入 SAR，直接算出方形像素画布中的实际显示尺寸。
  const filter = `setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${input.duration},trim=start=${input.segment.video!.start},setpts=PTS-STARTPTS,scale=w='max(2,trunc(min(1920,1080*dar)/2)*2)':h='max(2,trunc(min(1080,1920/dar)/2)*2)',setsar=1,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=${settings.fps},tpad=stop_mode=clone:stop_duration=${input.duration},subtitles=subtitle-${index}.ass:wrap_unicode=1`;
  // 无损中间片段避免重复编码损失；最终全片只做一次所选视频编码和 AAC 编码。
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', ...localInput, '-i', input.video,
    ...localInput, '-i', input.audio, '-map', '0:v:0', '-map', '1:a:0', '-vf', filter, '-t', String(input.duration),
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
