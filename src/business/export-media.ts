import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExportSettings } from '../shared/contracts.js';

const execute = promisify(execFile);
export async function listExportFonts(): Promise<string[]> {
  try {
    const { stdout } = await execute('fc-list', ['--format', '%{family[0]}\n'], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    return [...new Set(stdout.split(/\r?\n/).map(value => value.trim()).filter(value => value.length > 0 && value.length <= 200 && !/[,\x00]/.test(value)))].sort();
  } catch { throw new Error('无法枚举字幕字体，请安装 Fontconfig 并确认 fc-list 可用'); }
}
export function missingExportSettings(settings: ExportSettings) {
  return [settings.fontFamily === null ? '请设置字幕字体' : '', settings.fontSize === null ? '请设置字幕字号' : ''].filter(Boolean);
}

// 以实际编码和解码验证当前设置；只写临时目录，不生成项目成片。
export async function verifyExportMedia(settings: ExportSettings, signal?: AbortSignal) {
  const directory = await mkdtemp(join(tmpdir(), 'clapgrid-export-probe-'));
  try {
    const filter: string[] = [];
    if (settings.fontFamily !== null && settings.fontSize !== null) {
      await writeFile(join(directory, 'probe.ass'), `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${settings.fontFamily},${settings.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,40,40,40,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,字幕测试 ClapGrid
`);
      filter.push('-vf', 'subtitles=probe.ass');
    }
    const options = { cwd: directory, timeout: 15000, maxBuffer: 2 * 1024 * 1024, signal };
    let stderr: string;
    try {
      ({ stderr } = await execute('ffmpeg', ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=${settings.fps}`, ...filter, '-frames:v', '2', ...exportEncodingArguments(settings), 'probe.mp4'], options));
    } catch (error) {
      if (signal?.aborted) throw new Error('修改连接已断开，导出设置未保存');
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('FFmpeg 不可用，请安装 FFmpeg（含 libx264、mpeg4、libass）和 ffprobe');
      throw new Error(`当前 FFmpeg 无法使用编码 ${settings.codec}、${settings.fps} fps${filter.length ? '及所选字幕字体字号（需 libass）' : ''}，请检查媒体组件`);
    }
    if (filter.length && !/Using font provider fontconfig/.test(stderr)) throw new Error('当前 FFmpeg 的字幕组件未使用 Fontconfig，无法确认所选字体；请安装使用 Fontconfig 的 libass 构建');
    try {
      const { stdout } = await execute('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt', '-of', 'json', 'probe.mp4'], options);
      const stream = JSON.parse(stdout).streams?.[0];
      if (stream?.codec_name !== (settings.codec === 'libx264' ? 'h264' : 'mpeg4') || stream.width !== 1920 || stream.height !== 1080 || stream.r_frame_rate !== `${settings.fps}/1` || stream.pix_fmt !== 'yuv420p') throw new Error('输出参数不匹配');
      await execute('ffmpeg', ['-v', 'error', '-xerror', '-i', 'probe.mp4', '-f', 'null', '-'], options);
    } catch { throw new Error('FFmpeg / ffprobe 无法确认 1920×1080 MP4 可解码及所选编码帧率，请检查媒体组件'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function exportEncodingArguments(settings: ExportSettings): string[] {
  return ['-c:v', settings.codec, ...(settings.codec === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : ['-q:v', '3']), '-r', String(settings.fps), '-pix_fmt', 'yuv420p', '-f', 'mp4'];
}
