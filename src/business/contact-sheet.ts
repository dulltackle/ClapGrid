import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContactSheet, ContactSheetRequest, ExportTask } from '../shared/contracts.js';
import { samplingTimes } from './frame-sampling.js';
import { mediaProcess } from './media-process.js';

const columns = 6;
const tileWidth = 320;
const tileHeight = 180;
const labelHeight = 28;
const headingHeight = 44;
const background = '0x171a21';
const localMp4 = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov'];
const drawText = "drawtext=font='Noto Sans CJK SC':fontcolor=white:expansion=none:x=12";

export async function createContactSheet({ projectDirectory, task, source, sampling, signal, checkCurrent }: {
  projectDirectory: string; task: ExportTask; source: string; sampling: ContactSheetRequest['sampling']; signal: AbortSignal; checkCurrent: () => void;
}): Promise<ContactSheet> {
  const { stdout } = await mediaProcess('ffprobe', ['-v', 'error', ...localMp4, '-select_streams', 'v:0',
    '-show_entries', 'format=duration:stream=r_frame_rate,nb_frames', '-of', 'json', source], { signal });
  const media = JSON.parse(stdout);
  const video = media.streams?.[0];
  const [rate, denominator] = String(video?.r_frame_rate).split('/');
  const fps = Number(rate) / Number(denominator);
  const frameCount = Number(video?.nb_frames);
  const boundaries = task.segmentBoundaries ?? [];
  const duration = task.preview ? boundaries[0]?.duration ?? Number(media.format?.duration) : Number(media.format?.duration);
  if (!(Number.isFinite(duration) && duration > 0 && Number.isFinite(fps) && fps > 0 && Number.isSafeInteger(frameCount) && frameCount > 0)) {
    throw new Error('无法确认导出产物的视频时长或帧率');
  }
  const times = [...samplingTimes(sampling, duration, `视频区间 [0, ${duration}) 内`)].sort((a, b) => a - b);
  const heading = `${task.preview ? '片段合成预览' : '成片'} · 导出任务 ${task.id} · ${task.finishedAt ? '导出时间 ' + task.finishedAt : '受理时间 ' + task.createdAt}${boundaries.length ? '' : ' · 片段未标注'}`;
  const cache = join(projectDirectory, '.cache', 'review-frames');
  for (const directory of [join(projectDirectory, '.cache'), cache]) {
    await mkdir(directory, { recursive: true });
    if (await realpath(directory) !== directory) throw new Error('接触印样缓存目录不能是符号链接');
  }
  const directory = await mkdtemp(join(cache, 'run-'));
  const path = join(directory, 'contact-sheet.png');
  const tiles = join(directory, 'tiles');
  const frames: ContactSheet['frames'] = [];
  try {
    await mkdir(tiles);
    await writeFile(join(tiles, 'heading.txt'), heading);
    for (const [index, time] of times.entries()) {
      // 取该时刻正在显示的帧。尾部若只有音轨，沿用最后一帧。
      const frame = Math.min(frameCount - 1, Math.floor(Number((time * fps).toPrecision(15))));
      const frameTime = frame / fps;
      const boundary = boundaries.find((segment, index) => segment.visualStart <= frameTime && frameTime < (boundaries[index + 1]?.visualStart ?? Infinity));
      const segmentTime = boundary ? Number(Math.max(0, time - boundary.visualStart).toPrecision(12)) : null;
      const timeLabel = `${time.toFixed(3)}s`;
      const label = boundary && segmentTime !== null
        ? `#${boundary.order} · ${segmentTime.toFixed(3)}s${task.preview ? '' : ` · ${timeLabel}`}`
        : timeLabel;
      const framePath = join(directory, `frame-${index}.png`);
      const seek = Math.floor(frameTime * 1_000_000) / 1_000_000;
      const filter = `[0:v:0]split[original][small];[small]scale=${tileWidth}:${tileHeight},pad=iw:ih+${labelHeight}:0:0:color=${background},${drawText}:fontsize=16:y=${tileHeight + 5}:text='${label}'[tile]`;
      await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-filter_complex_threads', '1', '-threads', '2', ...localMp4, '-ss', seek.toFixed(6), '-i', source,
        '-filter_complex', filter, '-map', '[original]', '-frames:v', '1', '-threads', '1', framePath,
        '-map', '[tile]', '-frames:v', '1', '-threads', '1', join(tiles, `tile-${index}.png`)], { signal });
      await stat(framePath);
      frames.push({ time, order: boundary?.order ?? null, segmentId: boundary?.segmentId ?? null, segmentTime, label, path: framePath });
    }
    const rows = Math.ceil(frames.length / columns);
    const filter = `tile=${columns}x${rows}:color=${background},pad=iw:ih+${headingHeight}:0:${headingHeight}:color=${background},${drawText}:fontsize=20:y=12:textfile=heading.txt`;
    await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-filter_threads', '1', '-threads', '1', '-start_number', '0', '-i', 'tile-%d.png',
      '-vf', filter, '-frames:v', '1', '-threads', '1', path], { cwd: tiles, signal });
    await stat(path);
    await rm(tiles, { recursive: true });
    signal.throwIfAborted();
    checkCurrent();
    return { path, heading, frames };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
