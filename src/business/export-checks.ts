import type { ExportBlackInterval, ExportIssue, ExportLoudness, ExportSegmentBoundary } from '../shared/contracts.js';
import { mediaProcess } from './media-process.js';

const targetLufs = -14;
const targetDbtp = -1.5;
const loudnorm = `loudnorm=I=${targetLufs}:TP=${targetDbtp}`;

function measurement(value: unknown, message: string) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) throw new Error(message);
  return number;
}

export async function isSilentExportAudio(audio: string, signal: AbortSignal) {
  const { stderr } = await mediaProcess('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', '-nostdin', '-xerror', '-i', audio,
    '-af', 'astats=measure_perchannel=none:measure_overall=Peak_level', '-f', 'null', '-'], { signal });
  const peak = stderr.match(/Peak level dB:\s+(\S+)/)?.[1];
  return peak === '-inf' || measurement(peak, '无法读取配音的最大电平') < -50;
}

export async function measureExportAudio(input: string[], cwd: string, signal: AbortSignal) {
  const { stderr } = await mediaProcess('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', '-nostdin', '-xerror', ...input,
    '-map', '0:a:0', '-af', `asetpts=N/SR/TB,${loudnorm}:print_format=json`, '-f', 'null', '-'], { cwd, signal });
  const json = stderr.match(/\{\s*"input_i"[^}]*\}/)?.[0];
  const message = '无法读取标准化前的响度测量值';
  if (!json) throw new Error(message);
  const values = JSON.parse(json);
  const loudnessBefore: ExportLoudness = {
    integratedLufs: measurement(values.input_i, message),
    truePeakDbtp: measurement(values.input_tp, message),
    rangeLu: measurement(values.input_lra, message),
  };
  const threshold = measurement(values.input_thresh, message);
  const offset = measurement(values.target_offset, message);
  const { integratedLufs, truePeakDbtp, rangeLu } = loudnessBefore;
  const filter = `${loudnorm}:measured_I=${integratedLufs}:measured_TP=${truePeakDbtp}:measured_LRA=${rangeLu}:measured_thresh=${threshold}:offset=${offset}:linear=true`;
  return { loudnessBefore, filter };
}

export async function checkExport(cwd: string, signal: AbortSignal) {
  // 加一帧白画面闭合片尾黑场。用微秒时间戳判定时长，避免日志小数舍入和 stderr 截断。
  const videoFilter = 'tpad=stop=1:color=white,settb=AVTB,blackdetect=d=1.0:pix_th=0.10:pic_th=0.98,metadata=mode=print:file=-';
  const { stdout, stderr } = await mediaProcess('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', '-nostdin', '-xerror', '-i', 'result.mp4',
    '-map', '0:v:0', '-map', '0:a:0', '-vf', videoFilter, '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'], { cwd, signal });
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const message = '无法读取成片的响度复测值';
  const loudnessAfter: ExportLoudness = {
    integratedLufs: measurement(summary.match(/\bI:\s+(\S+) LUFS/)?.[1], message),
    truePeakDbtp: measurement(summary.match(/True peak:\s+Peak:\s+(\S+) dBFS/)?.[1], message),
    rangeLu: measurement(summary.match(/\bLRA:\s+(\S+) LU/)?.[1], message),
  };
  const blackIntervals: ExportBlackInterval[] = [];
  let start: number | undefined;
  let timestamp = 0;
  for (const line of stdout.split('\n')) {
    const frame = line.match(/^frame:\d+[ \t]+pts:(\d+)/);
    if (frame) timestamp = Number(frame[1]);
    else if (line.startsWith('lavfi.black_start=')) start = timestamp;
    else if (line.startsWith('lavfi.black_end=')) {
      if (start === undefined || timestamp < start) throw new Error('无法读取成片的黑场区间');
      if (timestamp - start >= 1_000_000) blackIntervals.push({ start: start / 1_000_000, end: timestamp / 1_000_000 });
      start = undefined;
    }
  }
  if (start !== undefined) throw new Error('无法读取成片的黑场结束时间');
  return { loudnessAfter, blackIntervals };
}

export function blackIntervalWarnings(intervals: ExportBlackInterval[], boundaries: ExportSegmentBoundary[]): ExportIssue[] {
  return intervals.flatMap(({ start, end }) => {
    const message = `检测到黑场 ${start.toFixed(1)}–${end.toFixed(1)} 秒（全片时间），可能为有意设计`;
    return boundaries.filter(boundary => boundary.start < end && start < Number((boundary.start + boundary.duration).toFixed(6)))
      .map(({ order, segmentId }) => ({ order, segmentId, field: 'video', message }));
  });
}

export function exportLoudnessWarning({ integratedLufs, truePeakDbtp, rangeLu }: ExportLoudness): ExportIssue | undefined {
  if (Math.abs(integratedLufs - targetLufs) <= 1 && truePeakDbtp <= -1) return;
  return { field: 'project', message: `成片响度偏离目标（${integratedLufs.toFixed(1)} LUFS · 真峰值 ${truePeakDbtp.toFixed(1)} dBTP · 响度范围 ${rangeLu.toFixed(1)} LU）` };
}
