import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pageFrameLimit, type ExportSettings, type PageFrames } from '../shared/contracts.js';
import { subtitle } from './export-render.js';
import { mediaProcess } from './media-process.js';
import { pageGeometry, pageOutputTransform, runPageWorker, type PageLayer, type PageWorkerInput } from './page-worker-input.js';
import type { PixelBox } from './page-diagnostics.js';

function samplingTimes(sampling: PageFrames['sampling'], duration: number) {
  if ('times' in sampling) {
    if (sampling.times.some(time => time >= duration)) throw new Error('抽帧时间须位于图层局部区间 [0, DUR) 内');
    return sampling.times;
  }
  const { from, to, interval } = sampling;
  if (from > to || to >= duration) throw new Error('抽帧区间须位于图层局部区间 [0, DUR) 内，且起点不大于终点');
  const count = Math.floor((to - from) / interval + 1e-9) + 1;
  if (count > pageFrameLimit) throw new Error(`每次最多抽取 ${pageFrameLimit} 帧`);
  return Array.from({ length: count }, (_, i) => Math.min(to, Number((from + i * interval).toPrecision(15))));
}

async function subtitleBox(directory: string, settings: ExportSettings, text: string, signal: AbortSignal): Promise<PixelBox | undefined> {
  if (!settings.fontFamily || !settings.fontSize || !text.trim()) return;
  await writeFile(join(directory, 'subtitle.ass'), subtitle(settings, text, true), { flag: 'wx' });
  // 与导出使用相同的 ASS、分辨率及换行规则；白色描边让实际占位可从黑底测出。
  const { stderr } = await mediaProcess('ffmpeg', ['-v', 'info', '-nostdin', '-filter_threads', '1', '-f', 'lavfi', '-i', 'color=black:s=1920x1080', '-vf',
    'subtitles=subtitle.ass:wrap_unicode=1,bbox=min_val=16', '-frames:v', '1', '-f', 'null', '-'], { cwd: directory, signal });
  const box = /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(stderr);
  if (box) {
    const [, x1, x2, y1, y2] = box.map(Number);
    return { x: x1!, y: y1!, width: x2! - x1! + 1, height: y2! - y1! + 1 };
  }
}

export async function inspectPages(input: {
  projectDirectory: string; segmentId: string; text: string; settings: ExportSettings;
  layers: { layer: PageLayer; layerIndex: number }[];
  asset: (id: string) => { path: string; mime: string }; sampling?: PageFrames['sampling']; signal: AbortSignal;
}) {
  const { signal, settings, sampling, layers } = input;
  const selected = layers[0]!;
  const times = sampling && samplingTimes(sampling, selected.layer.to - selected.layer.from);
  const cache = join(input.projectDirectory, '.cache', 'page-inspection');
  // 不通过项目内的符号链接写到其他位置。
  for (const directory of [join(input.projectDirectory, '.cache'), cache]) {
    await mkdir(directory, { recursive: true });
    if (await realpath(directory) !== directory) throw new Error('页面自检缓存目录不能是符号链接');
  }
  const directory = await mkdtemp(join(cache, 'run-'));
  let keepFrames = false;
  const run = (layer: PageLayer, output: string, diagnostic: NonNullable<PageWorkerInput['diagnostic']>, index: number) =>
    runPageWorker({ projectDirectory: input.projectDirectory, pageId: layer.pageId, assets: Object.fromEntries(layer.assetIds.map(id => [id, input.asset(id)])),
      ...pageGeometry(layer), duration: layer.to - layer.from, fps: settings.fps, transparent: layer.role === 'overlay', output, diagnostic },
    join(directory, `input-${index}.json`), signal);
  try {
    if (times) {
      const output = join(directory, 'frames');
      await mkdir(output);
      await run(selected.layer, output, { kind: 'frames', times }, selected.layerIndex);
      await rm(join(directory, `input-${selected.layerIndex}.json`));
      signal.throwIfAborted();
      keepFrames = true;
      return { segmentId: input.segmentId, layerIndex: selected.layerIndex, pageId: selected.layer.pageId,
        frames: times.map((time, index) => ({ time, path: join(output, `frame-${index}.png`) })) };
    }
    const box = await subtitleBox(directory, settings, input.text, signal);
    const results = [];
    for (const { layer, layerIndex } of layers) {
      const output = join(directory, `report-${layerIndex}.json`);
      await run(layer, output, { kind: 'check', ...pageOutputTransform(layer), subtitle: box }, layerIndex);
      const report = JSON.parse(await readFile(output, 'utf8'));
      results.push({ pageId: layer.pageId, layerIndex, from: layer.from, to: layer.to, text: report.text, determinism: report.determinism });
    }
    return { segmentId: input.segmentId, subtitle: !settings.fontFamily || !settings.fontSize ? { status: 'not-checked', reason: '缺少导出字幕字体或字号' } : { status: 'checked', box: box ?? null }, layers: results };
  } finally {
    if (!keepFrames) await rm(directory, { recursive: true, force: true });
  }
}
