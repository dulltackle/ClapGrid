import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportSettings, PageFrames } from '../shared/contracts.js';
import { samplingTimes } from './frame-sampling.js';
import { pageGeometry, pageOutputTransform, runPageWorker, type PageLayer, type PageWorkerInput } from './page-worker-input.js';
import type { PixelBox } from './page-diagnostics.js';

export async function inspectPages(input: {
  projectDirectory: string; segmentId: string; styleId?: string; settings: ExportSettings;
  layers: { layer: PageLayer; layerIndex: number }[];
  asset: (id: string) => { path: string; mime: string }; sampling?: PageFrames['sampling']; signal: AbortSignal;
}) {
  const { signal, settings, sampling, layers } = input;
  const selected = layers[0]!;
  const times = sampling && samplingTimes(sampling, selected.layer.to - selected.layer.from, '图层局部区间 [0, DUR) 内');
  const cache = join(input.projectDirectory, '.cache', 'page-inspection');
  // 不通过项目内的符号链接写到其他位置。
  for (const directory of [join(input.projectDirectory, '.cache'), cache]) {
    await mkdir(directory, { recursive: true });
    if (await realpath(directory) !== directory) throw new Error('页面自检缓存目录不能是符号链接');
  }
  const directory = await mkdtemp(join(cache, 'run-'));
  let keepFrames = false;
  const run = (layer: PageLayer, output: string, diagnostic: NonNullable<PageWorkerInput['diagnostic']>, index: number) =>
    runPageWorker({ projectDirectory: input.projectDirectory, styleId: input.styleId, pageId: layer.pageId, assets: Object.fromEntries(layer.assetIds.map(id => [id, input.asset(id)])),
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
    let box: PixelBox | undefined;
    if (input.styleId) {
      const output = join(directory, 'subtitle-region.json');
      await runPageWorker({
        projectDirectory: input.projectDirectory, styleId: input.styleId, subtitleText: '', assets: {},
        width: 1920, height: 1080, duration: 1, fps: settings.fps, transparent: true, output, diagnostic: { kind: 'subtitle-region' },
      }, join(directory, 'subtitle-input.json'), signal);
      box = JSON.parse(await readFile(output, 'utf8'));
    }
    const results = [];
    for (const { layer, layerIndex } of layers) {
      const output = join(directory, `report-${layerIndex}.json`);
      await run(layer, output, { kind: 'check', ...pageOutputTransform(layer), subtitle: box }, layerIndex);
      const report = JSON.parse(await readFile(output, 'utf8'));
      results.push({ pageId: layer.pageId, layerIndex, from: layer.from, to: layer.to, text: report.text, determinism: report.determinism });
    }
    return { segmentId: input.segmentId, subtitle: box ? { status: 'checked', box } : { status: 'not-checked', reason: '未设置项目风格' }, layers: results };
  } finally {
    if (!keepFrames) await rm(directory, { recursive: true, force: true });
  }
}
