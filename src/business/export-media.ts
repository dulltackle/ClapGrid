import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mediaProcess } from './media-process.js';
import type { ExportSettings } from '../shared/contracts.js';

// 以实际编码和解码验证当前设置；只写临时目录，不生成项目成片。
export async function verifyExportMedia(settings: ExportSettings, signal?: AbortSignal) {
  const directory = await mkdtemp(join(tmpdir(), 'clapgrid-export-probe-'));
  try {
    const options = { cwd: directory, timeout: 15000, signal };
    try {
      await mediaProcess('ffmpeg', ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=${settings.fps}`, '-frames:v', '2', ...exportEncodingArguments(settings), 'probe.mp4'], options);
    } catch (error) {
      if (signal?.aborted) throw new Error('修改连接已断开，导出设置未保存');
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('FFmpeg 不可用，请安装 FFmpeg（含 libx264、mpeg4）和 ffprobe');
      throw new Error(`当前 FFmpeg 无法使用编码 ${settings.codec}、${settings.fps} fps，请检查媒体组件`);
    }
    try {
      const { stdout } = await mediaProcess('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt', '-of', 'json', 'probe.mp4'], options);
      const stream = JSON.parse(stdout).streams?.[0];
      if (stream?.codec_name !== (settings.codec === 'libx264' ? 'h264' : 'mpeg4') || stream.width !== 1920 || stream.height !== 1080 || stream.r_frame_rate !== `${settings.fps}/1` || stream.pix_fmt !== 'yuv420p') throw new Error('输出参数不匹配');
      await mediaProcess('ffmpeg', ['-v', 'error', '-xerror', '-i', 'probe.mp4', '-f', 'null', '-'], options);
      await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-i', 'probe.mp4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.08', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'ffv1', '-threads', '2', '-c:a', 'pcm_s16le', 'intermediate.mkv'], options);
      await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-i', 'intermediate.mkv', '-vf', 'scale=960:540', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '2', '-c:a', 'libvorbis', 'preview.webm'], options);
    } catch { throw new Error('FFmpeg / ffprobe 无法确认 1920×1080 MP4 可解码及所选编码帧率，请检查 FFmpeg 的 ffv1、libvpx、libvorbis 媒体组件'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function exportEncodingArguments(settings: ExportSettings): string[] {
  return ['-c:v', settings.codec, ...(settings.codec === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : ['-q:v', '3']), '-r', String(settings.fps), '-pix_fmt', 'yuv420p', '-f', 'mp4'];
}
